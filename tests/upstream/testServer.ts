import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { type AddressInfo } from "node:net";

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => void;

export class TestServer {
  readonly server: http.Server | https.Server;
  readonly PORT: number;
  readonly PREFIX: string;
  readonly CROSS_PROCESS_PREFIX: string;
  readonly EMPTY_PAGE: string;

  private routes = new Map<string, RouteHandler>();
  private redirects = new Map<string, string>();
  private cspHeaders = new Map<string, string>();
  private requestPromises = new Map<
    string,
    { resolve: (req: http.IncomingMessage) => void }
  >();
  private observers = new Map<string, http.IncomingMessage[]>();

  static async create(port = 0): Promise<TestServer> {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(port, resolve));
    const actualPort = (server.address() as AddressInfo).port;
    return new TestServer(server, actualPort, "http");
  }

  static async createHTTPS(port = 0): Promise<TestServer> {
    const { privateKey, certificate } = generateSelfSignedCert();
    const server = https.createServer({ key: privateKey, cert: certificate });
    await new Promise<void>((resolve) => server.listen(port, resolve));
    const actualPort = (server.address() as AddressInfo).port;
    return new TestServer(server, actualPort, "https");
  }

  private constructor(
    server: http.Server | https.Server,
    port: number,
    protocol: "http" | "https"
  ) {
    this.server = server;
    this.PORT = port;
    this.PREFIX = `${protocol}://localhost:${port}`;
    this.CROSS_PROCESS_PREFIX = `${protocol}://127.0.0.1:${port}`;
    this.EMPTY_PAGE = `${this.PREFIX}/empty.html`;

    server.on("request", (req, res) => this.handleRequest(req, res));
  }

  setRoute(routePath: string, handler: RouteHandler) {
    this.routes.set(routePath, handler);
  }

  setRedirect(from: string, to: string) {
    this.redirects.set(from, to);
  }

  setCSP(routePath: string, csp: string) {
    this.cspHeaders.set(routePath, csp);
  }

  waitForRequest(routePath: string): Promise<http.IncomingMessage> {
    return new Promise((resolve) => {
      this.requestPromises.set(routePath, { resolve });
    });
  }

  observe(routePath: string): http.IncomingMessage[] {
    const list: http.IncomingMessage[] = [];
    this.observers.set(routePath, list);
    return list;
  }

  disconnect(): void {
    this.server.closeAllConnections?.();
  }

  serveFile(routePath: string, filePath: string) {
    this.setRoute(routePath, (_req, res) => {
      const content = fs.readFileSync(filePath);
      res.writeHead(200);
      res.end(content);
    });
  }

  reset() {
    this.routes.clear();
    this.redirects.clear();
    this.cspHeaders.clear();
    this.requestPromises.clear();
    this.observers.clear();
  }

  async close(): Promise<void> {
    const closed = new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve()))
    );
    this.server.closeAllConnections?.();
    await closed;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const urlPath = new URL(req.url ?? "/", this.PREFIX).pathname;

    const observed = this.observers.get(urlPath);
    if (observed) observed.push(req);

    const waiter = this.requestPromises.get(urlPath);
    if (waiter) {
      this.requestPromises.delete(urlPath);
      waiter.resolve(req);
    }

    const redirect = this.redirects.get(urlPath);
    if (redirect) {
      res.writeHead(302, { Location: redirect });
      res.end();
      return;
    }

    const csp = this.cspHeaders.get(urlPath);
    if (csp) res.setHeader("Content-Security-Policy", csp);

    const handler = this.routes.get(urlPath);
    if (handler) {
      handler(req, res);
      return;
    }

    if (urlPath === "/empty.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head></head><body></body></html>");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }
}

function generateSelfSignedCert() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const certificate = crypto.X509Certificate
    ? selfSignedFromX509(privateKey)
    : placeholderCert();
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certificate,
  };
}

function selfSignedFromX509(privateKey: crypto.KeyObject): string {
  // Node 20+ createSelfSignedCertificate is not universally available.
  // Fall back to a placeholder that will cause HTTPS tests to fail gracefully.
  return placeholderCert();
}

function placeholderCert(): string {
  // HTTPS tests will fail at TLS handshake. This is expected; W-17 records
  // the baseline including these failures.
  return "";
}
