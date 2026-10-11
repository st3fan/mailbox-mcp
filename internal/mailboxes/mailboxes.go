// Package mailboxes implements the mailbox-mcp MCP tools for managing
// mailboxes on a Cloudflare domain: creating, listing, and deleting Email
// Routing rules that route mail to the configured Email Worker, and reading
// and managing the messages those mailboxes receive.
package mailboxes

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/0x6flab/namegenerator"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/cloudflare"
	"github.com/st3fan/mailbox-mcp/internal/config"
)

// client is the subset of the Cloudflare client the tools use. It exists so
// tests can supply a fake.
type client interface {
	ListRules(ctx context.Context, zoneID string) ([]cloudflare.Rule, error)
	CreateMailboxRule(ctx context.Context, zoneID, address, worker string) (*cloudflare.Rule, error)
	DeleteRule(ctx context.Context, zoneID, ruleID string) error
	UpdateRuleStatus(ctx context.Context, zoneID, ruleID string, enabled bool) error
}

// Register wires the mailbox tools onto the server.
func Register(srv *mcp.Server, cfg config.Config, zoneID string, client client) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_mailbox",
		Description: fmt.Sprintf("Create a mailbox on %s: an email address that receives mail routed to the %s worker.", cfg.Domain, cfg.EmailWorker),
	}, createMailbox(cfg, zoneID, client))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_mailboxes",
		Description: fmt.Sprintf("List the mailboxes that exist on %s. Only mailboxes managed by mailbox-mcp are listed, not other routing rules on the domain.", cfg.Domain),
	}, listMailboxes(cfg, zoneID, client))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "delete_mailbox",
		Description: fmt.Sprintf("Delete a mailbox on %s. The mailbox must have been created by mailbox-mcp.", cfg.Domain),
	}, deleteMailbox(cfg, zoneID, client))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_random_mailbox",
		Description: fmt.Sprintf("Create a new mailbox on %s with a random name like first.last@%s, routed to the %s worker.", cfg.Domain, cfg.Domain, cfg.EmailWorker),
	}, createRandomMailbox(cfg, zoneID, client))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "enable_mailbox",
		Description: fmt.Sprintf("Enable a mailbox on %s: mail to the address is routed to the %s worker again.", cfg.Domain, cfg.EmailWorker),
	}, enableMailbox(cfg, zoneID, client))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "disable_mailbox",
		Description: fmt.Sprintf("Disable a mailbox on %s: the mailbox keeps existing but mail to the address is no longer routed to the %s worker.", cfg.Domain, cfg.EmailWorker),
	}, disableMailbox(cfg, zoneID, client))
}

// createInput is the input of the create_mailbox tool.
type createInput struct {
	// Address is the full mailbox address, for example "alice@mail.example.com".
	Address string `json:"address" jsonschema:"the mailbox address to create, local@domain"`
}

// createRandomInput is the input of the create_random_mailbox tool. It is empty.
type createRandomInput struct{}

// randomNameGenerator generates the local part of random mailbox addresses.
// It is a package variable so tests can replace it. The generator joins the
// two names with "-" (WithSeparator is not in a tagged release yet), which we
// translate to "." for the email local part.
var randomNameGenerator = namegenerator.NewGenerator()

// maxRandomCreateAttempts is how often create_random_mailbox retries with a
// new random name when Cloudflare reports the address already exists.
const maxRandomCreateAttempts = 3

// randomAddress returns a generated address like john.smith@example.com. The
// generated name is lowercased (the local part is displayed as-is in lists and
// Cloudflare matches the domain case-insensitively) and its name separator is
// turned into a dot, per the first.last@domain address format.
func randomAddress(domain string) string {
	name := strings.ReplaceAll(randomNameGenerator.Generate(), "-", ".")
	return strings.ToLower(name) + "@" + domain
}

// isDuplicateAddressError reports whether err is Cloudflare complaining that a
// routing rule for the address already exists.
func isDuplicateAddressError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already exist") || strings.Contains(msg, "duplicate")
}

func createRandomMailbox(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[createRandomInput, mailbox] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input createRandomInput) (*mcp.CallToolResult, mailbox, error) {
		var lastErr error
		for attempt := 0; attempt < maxRandomCreateAttempts; attempt++ {
			address := randomAddress(cfg.Domain)
			rule, err := client.CreateMailboxRule(ctx, zoneID, address, cfg.EmailWorker)
			if err != nil {
				if isDuplicateAddressError(err) {
					lastErr = err
					continue
				}
				return nil, mailbox{}, err
			}
			return nil, mailbox{Address: address, RuleID: rule.ID, Enabled: rule.Enabled}, nil
		}
		return nil, mailbox{}, fmt.Errorf("no unique random mailbox after %d attempts: %w", maxRandomCreateAttempts, lastErr)
	}
}

// mailbox is a single managed mailbox.
type mailbox struct {
	Address string `json:"address"`
	RuleID  string `json:"rule_id"`
	Enabled bool   `json:"enabled"`
}

func createMailbox(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[createInput, mailbox] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input createInput) (*mcp.CallToolResult, mailbox, error) {
		address := strings.TrimSpace(input.Address)
		if err := validateAddress(address, cfg.Domain); err != nil {
			return nil, mailbox{}, err
		}
		address = normalizeAddress(address)
		rule, err := client.CreateMailboxRule(ctx, zoneID, address, cfg.EmailWorker)
		if err != nil {
			return nil, mailbox{}, err
		}
		return nil, mailbox{Address: address, RuleID: rule.ID, Enabled: rule.Enabled}, nil
	}
}

// listInput is the input of the list_mailboxes tool. It is empty.
type listInput struct{}

// listOutput is the output of the list_mailboxes tool.
type listOutput struct {
	Mailboxes []mailbox `json:"mailboxes"`
}

func listMailboxes(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[listInput, listOutput] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input listInput) (*mcp.CallToolResult, listOutput, error) {
		rules, err := client.ListRules(ctx, zoneID)
		if err != nil {
			return nil, listOutput{}, err
		}
		boxes := []mailbox{}
		for _, rule := range rules {
			address, ok := mailboxAddress(rule, cfg.EmailWorker)
			if !ok {
				continue
			}
			boxes = append(boxes, mailbox{Address: address, RuleID: rule.ID, Enabled: rule.Enabled})
		}
		sort.Slice(boxes, func(i, j int) bool { return boxes[i].Address < boxes[j].Address })
		return nil, listOutput{Mailboxes: boxes}, nil
	}
}

// deleteInput is the input of the delete_mailbox tool.
type deleteInput struct {
	// Address is the full mailbox address to delete.
	Address string `json:"address" jsonschema:"the mailbox address to delete"`
}

// deleteOutput is the output of the delete_mailbox tool.
type deleteOutput struct {
	Address string `json:"address"`
	RuleID  string `json:"rule_id"`
}

func deleteMailbox(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[deleteInput, deleteOutput] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input deleteInput) (*mcp.CallToolResult, deleteOutput, error) {
		address := strings.TrimSpace(input.Address)
		if err := validateAddress(address, cfg.Domain); err != nil {
			return nil, deleteOutput{}, err
		}
		rules, err := client.ListRules(ctx, zoneID)
		if err != nil {
			return nil, deleteOutput{}, err
		}
		for _, rule := range rules {
			if ruleAddress, ok := mailboxAddress(rule, cfg.EmailWorker); ok && strings.EqualFold(ruleAddress, address) {
				if err := client.DeleteRule(ctx, zoneID, rule.ID); err != nil {
					return nil, deleteOutput{}, err
				}
				return nil, deleteOutput{Address: address, RuleID: rule.ID}, nil
			}
		}
		return nil, deleteOutput{}, fmt.Errorf("mailbox %q not found", address)
	}
}

// enableInput is the input of the enable_mailbox tool.
type enableInput struct {
	// Address is the full mailbox address to enable.
	Address string `json:"address" jsonschema:"the mailbox address to enable"`
}

func enableMailbox(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[enableInput, mailbox] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input enableInput) (*mcp.CallToolResult, mailbox, error) {
		return setMailboxEnabled(ctx, cfg, zoneID, client, input.Address, true)
	}
}

// disableInput is the input of the disable_mailbox tool.
type disableInput struct {
	// Address is the full mailbox address to disable.
	Address string `json:"address" jsonschema:"the mailbox address to disable"`
}

func disableMailbox(cfg config.Config, zoneID string, client client) mcp.ToolHandlerFor[disableInput, mailbox] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input disableInput) (*mcp.CallToolResult, mailbox, error) {
		return setMailboxEnabled(ctx, cfg, zoneID, client, input.Address, false)
	}
}

// setMailboxEnabled resolves the mailbox by address and sets the enabled flag
// of its routing rule. It is the shared implementation of enable and disable.
func setMailboxEnabled(ctx context.Context, cfg config.Config, zoneID string, client client, address string, enabled bool) (*mcp.CallToolResult, mailbox, error) {
	address = strings.TrimSpace(address)
	if err := validateAddress(address, cfg.Domain); err != nil {
		return nil, mailbox{}, err
	}
	rules, err := client.ListRules(ctx, zoneID)
	if err != nil {
		return nil, mailbox{}, err
	}
	for _, rule := range rules {
		if ruleAddress, ok := mailboxAddress(rule, cfg.EmailWorker); ok && strings.EqualFold(ruleAddress, address) {
			if err := client.UpdateRuleStatus(ctx, zoneID, rule.ID, enabled); err != nil {
				return nil, mailbox{}, err
			}
			return nil, mailbox{Address: address, RuleID: rule.ID, Enabled: enabled}, nil
		}
	}
	return nil, mailbox{}, fmt.Errorf("mailbox %q not found", address)
}

// mailboxAddress returns the mailbox address of a rule if the rule is a
// mailbox rule: a literal "to" matcher routed to the given worker. It returns
// false for every other kind of rule, so other routing rules on the domain are
// never mistaken for mailboxes.
func mailboxAddress(rule cloudflare.Rule, worker string) (string, bool) {
	if !routesToWorker(rule, worker) {
		return "", false
	}
	for _, m := range rule.Matchers {
		if m.Type == "literal" && m.Field == "to" && m.Value != "" {
			return m.Value, true
		}
	}
	return "", false
}

func routesToWorker(rule cloudflare.Rule, worker string) bool {
	for _, a := range rule.Actions {
		if a.Type != "worker" {
			continue
		}
		for _, v := range a.Value {
			if v == worker {
				return true
			}
		}
	}
	return false
}

// normalizeAddress lowercases the domain part of a validated mailbox address,
// so rules are created with a canonical form. The local part is kept as typed.
func normalizeAddress(address string) string {
	local, domain, _ := strings.Cut(address, "@")
	return local + "@" + strings.ToLower(domain)
}

// validateAddress checks that address is a valid mailbox on the configured
// domain. It runs before any API call is made.
func validateAddress(address, domain string) error {
	if address == "" {
		return errors.New("address is required")
	}
	if strings.ContainsAny(address, " \t\r\n") {
		return fmt.Errorf("%q is not a valid mailbox address: contains whitespace", address)
	}
	local, atDomain, found := strings.Cut(address, "@")
	if !found {
		return fmt.Errorf("%q is not a valid mailbox address: missing @", address)
	}
	if local == "" {
		return fmt.Errorf("%q is not a valid mailbox address: missing local part", address)
	}
	if strings.Contains(atDomain, "@") {
		return fmt.Errorf("%q is not a valid mailbox address: multiple @", address)
	}
	if !strings.EqualFold(atDomain, domain) {
		return fmt.Errorf("%q is not a mailbox on %s", address, domain)
	}
	return nil
}
