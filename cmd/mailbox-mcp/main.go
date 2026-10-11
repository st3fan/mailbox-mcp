// Command mailbox-mcp is an MCP server that manages mailboxes on a Cloudflare
// domain via Email Routing.
package main

import (
	"log"

	"github.com/st3fan/mailbox-mcp/internal/config"
	"github.com/st3fan/mailbox-mcp/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("mailbox-mcp: invalid configuration: %v", err)
	}
	if err := server.Run(cfg); err != nil {
		log.Fatalf("mailbox-mcp: %v", err)
	}
}
