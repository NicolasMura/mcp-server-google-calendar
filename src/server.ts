import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPrivateKey, timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import { google } from "googleapis";
import { z } from "zod";

dotenv.config();

const INPUT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
const DEFAULT_TIMEZONE =
  process.env.CALENDAR_TIMEZONE ??
  Intl.DateTimeFormat().resolvedOptions().timeZone ??
  "UTC";
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
const HTTP_HOST = process.env.HOST ?? "0.0.0.0";
const HTTP_PORT = Number(process.env.PORT ?? "3000");
const MCP_API_KEY = process.env.MCP_API_KEY?.trim() ?? "";
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const ALLOW_ANY_HOST = process.env.ALLOW_ANY_HOST === "true";

const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return "";
  }

  return `${year}-${month}-${day}`;
};

const formatTimeInTimeZone = (date: Date, timeZone: string): string => {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const isGoogleApiLikeError = (
  err: unknown,
): err is { code?: number; message?: string } => {
  return typeof err === "object" && err !== null && "message" in err;
};

const normalizeServiceAccountPrivateKey = (rawValue: string): string => {
  let value = rawValue.trim();

  // Handle values copied with wrapping quotes in env files or dashboards.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { private_key?: unknown };
      if (typeof parsed.private_key === "string") {
        value = parsed.private_key;
      }
    } catch {
      // Keep original value when JSON parsing fails.
    }
  }

  return value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
};

const isReadablePrivateKey = (privateKey: string): boolean => {
  try {
    createPrivateKey(privateKey);
    return true;
  } catch {
    return false;
  }
};

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const isAuthorizedMcpRequest = (req: Request): boolean => {
  const authorization = req.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token || !MCP_API_KEY) {
    return false;
  }

  return constantTimeEqual(token, MCP_API_KEY);
};

const getCalendarAuth = () => {
  const serviceAccountClientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const serviceAccountPrivateKeyRaw =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const delegatedUserEmail = process.env.GOOGLE_DELEGATED_USER_EMAIL;

  if (
    !serviceAccountClientEmail ||
    !serviceAccountPrivateKeyRaw ||
    !delegatedUserEmail
  ) {
    return {
      error:
        "Server misconfiguration: GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and GOOGLE_DELEGATED_USER_EMAIL are all required.",
    };
  }

  const serviceAccountPrivateKey = normalizeServiceAccountPrivateKey(
    serviceAccountPrivateKeyRaw,
  );

  if (!isReadablePrivateKey(serviceAccountPrivateKey)) {
    return {
      error:
        "Invalid GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: unable to decode private key. Expected a PEM key from service account JSON (BEGIN PRIVATE KEY) with escaped newlines (\\n).",
    };
  }

  const auth = new google.auth.JWT({
    email: serviceAccountClientEmail,
    key: serviceAccountPrivateKey,
    scopes: [CALENDAR_READONLY_SCOPE],
    subject: delegatedUserEmail,
  });

  return {
    auth,
    authMode: "service-account-delegation" as const,
  };
};

// tool function
const getMyCalendarDataByDate = async (date: string) => {
  const calendarId = process.env.CALENDAR_ID;

  if (!calendarId) {
    return {
      error: "Server misconfiguration: CALENDAR_ID is required.",
    };
  }

  const authResult = getCalendarAuth();
  if ("error" in authResult) {
    return {
      error: authResult.error,
    };
  }

  const calendar = google.calendar({
    version: "v3",
    auth: authResult.auth,
  });

  const dayStartUtc = new Date(`${date}T00:00:00.000Z`);
  const queryStartUtc = new Date(dayStartUtc);
  queryStartUtc.setUTCDate(queryStartUtc.getUTCDate() - 1);
  const queryEndUtc = new Date(dayStartUtc);
  queryEndUtc.setUTCDate(queryEndUtc.getUTCDate() + 2);

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin: queryStartUtc.toISOString(),
      timeMax: queryEndUtc.toISOString(),
      maxResults: 250,
      singleEvents: true,
      orderBy: "startTime",
      timeZone: DEFAULT_TIMEZONE,
    });

    const events = res.data.items || [];
    const meetings = events
      .filter((event) => {
        const allDayDate = event.start?.date;
        if (allDayDate) {
          return allDayDate === date;
        }

        const dateTime = event.start?.dateTime;
        if (!dateTime) {
          return false;
        }

        return (
          formatDateInTimeZone(new Date(dateTime), DEFAULT_TIMEZONE) === date
        );
      })
      .map((event) => {
        const title = event.summary?.trim() || "(No title)";

        if (event.start?.date) {
          return `${title} (all-day)`;
        }

        if (event.start?.dateTime) {
          const when = formatTimeInTimeZone(
            new Date(event.start.dateTime),
            DEFAULT_TIMEZONE,
          );
          return `${title} at ${when}`;
        }

        return `${title} (time unavailable)`;
      });

    return {
      date,
      timezone: DEFAULT_TIMEZONE,
      authMode: authResult.authMode,
      meetings,
    };
  } catch (err) {
    if (isGoogleApiLikeError(err)) {
      const statusInfo = err.code ? ` (status ${err.code})` : "";
      return {
        error: `Google Calendar request failed${statusInfo}: ${err.message ?? "Unknown error"}`,
      };
    }

    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// register the tool to MCP
const createServer = () => {
  const server = new McpServer({
    name: "Nikouz's Calendar",
    version: "1.0.0",
  });

  server.registerTool(
    "getMyCalendarDataByDate",
    {
      description:
        "Returns meetings from my Google Calendar for a given date (YYYY-MM-DD), including all-day events and timezone-aware times.",
      inputSchema: {
        date: z.string().regex(INPUT_DATE_REGEX, {
          message: "Invalid date format. Expected YYYY-MM-DD.",
        }),
      },
    },
    async ({ date }) => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await getMyCalendarDataByDate(date)),
          },
        ],
      };
    },
  );

  return server;
};

const sendJsonRpcMethodNotAllowed = (res: Response) => {
  return res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
};

const startHttpServer = () => {
  if (!MCP_API_KEY) {
    throw new Error(
      "HTTP mode requires MCP_API_KEY for mandatory /mcp authentication.",
    );
  }

  if (!ALLOW_ANY_HOST && ALLOWED_HOSTS.length === 0) {
    throw new Error(
      "HTTP mode requires ALLOWED_HOSTS unless ALLOW_ANY_HOST=true.",
    );
  }

  const app = createMcpExpressApp({
    host: HTTP_HOST,
    allowedHosts: ALLOW_ANY_HOST ? undefined : ALLOWED_HOSTS,
  });

  app.use("/mcp", (req: Request, res: Response, next) => {
    if (isAuthorizedMcpRequest(req)) {
      next();
      return;
    }

    console.warn("Unauthorized /mcp request rejected", {
      ip: req.ip,
      userAgent: req.get("user-agent") ?? "unknown",
    });

    return res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized.",
      },
      id: null,
    });
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    return res.status(200).json({
      status: "ok",
      transport: "http",
      name: "Nikouz's Calendar",
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        return res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    return sendJsonRpcMethodNotAllowed(res);
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    return sendJsonRpcMethodNotAllowed(res);
  });

  app.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log("MCP HTTP authentication is enabled on /mcp (Bearer token).");
    if (ALLOW_ANY_HOST) {
      console.warn(
        "ALLOW_ANY_HOST=true disables DNS rebinding protection for host headers.",
      );
    } else {
      console.log(
        `MCP HTTP allowed hosts: ${ALLOWED_HOSTS.join(", ") || "(none)"}`,
      );
    }

    console.log(
      `MCP HTTP server listening on http://${HTTP_HOST}:${HTTP_PORT}/mcp`,
    );
  });
};

const init = async () => {
  if (MCP_TRANSPORT === "http") {
    startHttpServer();
    return;
  }

  if (MCP_TRANSPORT !== "stdio") {
    console.warn(
      `Unknown MCP_TRANSPORT "${MCP_TRANSPORT}". Falling back to stdio.`,
    );
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

// call the initialization
init().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
