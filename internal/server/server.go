// Package server creates and runs the mailbox-mcp MCP server.
package server

import (
	"context"
	"fmt"

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
)

// Run builds the MCP server from the given configuration and serves it until
// the transport closes. It resolves the configured domain to a Cloudflare zone
// before serving, so a misconfigured domain fails fast at startup. Only the
// stdio transport is supported.
func Run(cfg config.Config) error {
	switch cfg.Transport {
	case config.TransportStdio:
	default:
		return fmt.Errorf("unsupported transport %q", cfg.Transport)
	}

	ctx := context.Background()

	client := cloudflare.New(cfg.CloudflareAPIToken)
	zoneID, err := client.ResolveZone(ctx, cfg.Domain)
	if err != nil {
		return err
	}

	srv := mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, &mcp.ServerOptions{
		Instructions: guidance.Instructions,
	})
	mailboxes.Register(srv, cfg, zoneID, client)
	mailboxes.RegisterMessages(srv, messages.New(cfg.MessagesAPIURL, cfg.MessagesAPIToken), cfg.Domain)
	guidance.Register(srv)

	return srv.Run(ctx, &mcp.StdioTransport{})
}
