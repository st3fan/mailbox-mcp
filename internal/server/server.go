// Package server creates and runs the mailbox-mcp MCP server.
package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/cloudflare"
	"github.com/st3fan/mailbox-mcp/internal/config"
	"github.com/st3fan/mailbox-mcp/internal/guidance"
	"github.com/st3fan/mailbox-mcp/internal/mailboxes"
	"github.com/st3fan/mailbox-mcp/internal/messages"
)

const (
	name    = "mailbox-mcp"
	version = "0.1.0"

	// httpEndpointPath is the path the MCP endpoint is served at by the HTTP
	// transport, as streamable HTTP.
	httpEndpointPath = "/mcp"
)

// Run builds the MCP server from the given configuration and serves it until
// the transport closes. It resolves the configured domain to a Cloudflare zone
// before serving, so a misconfigured domain fails fast at startup. Transports:
// stdio (default) and streamable HTTP at /mcp.
func Run(cfg config.Config) error {
	ctx := context.Background()

	client := cloudflare.New(cfg.CloudflareAPIToken)
	zoneID, err := client.ResolveZone(ctx, cfg.Domain)
	if err != nil {
		return err
	}

	srv := newServer(cfg, zoneID)

	switch cfg.Transport {
	case config.TransportHTTP:
		return serveHTTP(srv, cfg.HTTPAddr)
	default:
		return srv.Run(ctx, &mcp.StdioTransport{})
	}
}

// newServer builds the MCP server with all tools and guidance registered.
// Building never touches the network; the Cloudflare client and the messages
// client only call out when a tool runs.
func newServer(cfg config.Config, zoneID string) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, &mcp.ServerOptions{
		Instructions: guidance.Instructions,
	})
	mailboxes.Register(srv, cfg, zoneID, cloudflare.New(cfg.CloudflareAPIToken))
	mailboxes.RegisterMessages(srv, messages.New(cfg.MessagesAPIURL, cfg.MessagesAPIToken), cfg.Domain)
	guidance.Register(srv)
	return srv
}

// serveHTTP serves the MCP server as streamable HTTP at /mcp on addr until
// the process is interrupted. The MCP server itself has no authentication,
// so this is intended for localhost unless the operator deliberately exposes
// it.
func serveHTTP(srv *mcp.Server, addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}
	fmt.Fprintf(os.Stderr, "mailbox-mcp: serving streamable HTTP at http://%s%s\n", ln.Addr(), httpEndpointPath)
	return serveHTTPOn(ln, srv)
}

// serveHTTPOn serves srv on the given listener; split from serveHTTP for
// tests, which bind an ephemeral port themselves.
func serveHTTPOn(ln net.Listener, srv *mcp.Server) error {
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, nil)
	mux := http.NewServeMux()
	mux.Handle(httpEndpointPath, handler)
	return (&http.Server{Handler: mux}).Serve(ln)
}
