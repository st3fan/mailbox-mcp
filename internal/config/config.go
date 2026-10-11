// Package config loads and validates the mailbox-mcp server configuration from
// environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

const (
	// EnvCloudflareAPIToken is the scoped Cloudflare API token used to talk to
	// the Email Routing API. It needs the Zone > Email Routing Rules > Edit
	// permission.
	EnvCloudflareAPIToken = "MAILBOX_MCP_CLOUDFLARE_API_TOKEN"

	// EnvDomain is the single email domain the server manages mailboxes on,
	// for example "mail.example.com".
	EnvDomain = "MAILBOX_MCP_DOMAIN"

	// EnvEmailWorker is the name of the Cloudflare Email Worker that mailboxes
	// route to.
	EnvEmailWorker = "MAILBOX_MCP_EMAIL_WORKER"

	// EnvTransport selects the MCP transport.
	EnvTransport = "MAILBOX_MCP_TRANSPORT"

	// DefaultEmailWorker is the worker used when EnvEmailWorker is unset.
	DefaultEmailWorker = "mailbox-mcp-email-worker"

	// DefaultTransport is the transport used when EnvTransport is unset.
	DefaultTransport = "stdio"
)

// TransportStdio is the only supported transport in this iteration.
const TransportStdio = "stdio"

// Config is the validated server configuration.
type Config struct {
	// CloudflareAPIToken authenticates calls to the Cloudflare API.
	CloudflareAPIToken string

	// Domain is the single email domain mailboxes are managed on.
	Domain string

	// EmailWorker is the Email Worker mailboxes route to.
	EmailWorker string

	// Transport is the MCP transport to serve on.
	Transport string
}

// Load reads the configuration from the environment, applies defaults, and
// validates it. It returns an error describing every problem it found, so a
// misconfigured server fails fast at startup.
func Load() (Config, error) {
	cfg := Config{
		CloudflareAPIToken: strings.TrimSpace(os.Getenv(EnvCloudflareAPIToken)),
		Domain:             strings.TrimSpace(os.Getenv(EnvDomain)),
		EmailWorker:        strings.TrimSpace(os.Getenv(EnvEmailWorker)),
		Transport:          strings.TrimSpace(os.Getenv(EnvTransport)),
	}
	if cfg.EmailWorker == "" {
		cfg.EmailWorker = DefaultEmailWorker
	}
	if cfg.Transport == "" {
		cfg.Transport = DefaultTransport
	}

	var errs []error
	if cfg.CloudflareAPIToken == "" {
		errs = append(errs, fmt.Errorf("%s is required", EnvCloudflareAPIToken))
	}
	if cfg.Domain == "" {
		errs = append(errs, fmt.Errorf("%s is required", EnvDomain))
	} else if err := validateDomain(cfg.Domain); err != nil {
		errs = append(errs, fmt.Errorf("%s: %w", EnvDomain, err))
	}
	switch cfg.Transport {
	case TransportStdio:
	default:
		errs = append(errs, fmt.Errorf("%s: unknown transport %q (supported: %s)", EnvTransport, cfg.Transport, TransportStdio))
	}
	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validateDomain performs a basic sanity check on a domain name. Full DNS
// validation happens when the domain is resolved against the Cloudflare API.
func validateDomain(domain string) error {
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return fmt.Errorf("%q is not a valid domain name: expected at least two labels", domain)
	}
	for _, label := range labels {
		if label == "" {
			return fmt.Errorf("%q is not a valid domain name: empty label", domain)
		}
		if len(label) > 63 {
			return fmt.Errorf("%q is not a valid domain name: label %q is longer than 63 characters", domain, label)
		}
		for _, r := range label {
			switch {
			case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			default:
				return fmt.Errorf("%q is not a valid domain name: invalid character %q in label %q", domain, r, label)
			}
		}
	}
	return nil
}
