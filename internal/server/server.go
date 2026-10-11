// Package server creates and runs the mailbox-mcp MCP server.
package server

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/config"
)

const (
	name    = "mailbox-mcp"
	version = "0.1.0"
)

// Run builds the MCP server from the given configuration and serves it until
// the transport closes. Only the stdio transport is supported.
func Run(cfg config.Config) error {
	switch cfg.Transport {
	case config.TransportStdio:
	default:
		return fmt.Errorf("unsupported transport %q", cfg.Transport)
	}

	srv := mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, nil)

	// Mailbox tools are registered in a later layer of the stack.

	return srv.Run(context.Background(), &mcp.StdioTransport{})
}
