# Validating the installer in Docker

Without installing on the host:

```bash
tools/validate_in_docker.sh                   # Debian: full install.sh, plugins read-only; install.ps1 parse check
tools/validate_in_docker.sh --distro fedora   # one distro: debian, ubuntu-24.04, ubuntu-26.04, fedora, arch
tools/validate_in_docker.sh --matrix          # all five in parallel plus a summary table (~5 min)
tools/validate_in_docker.sh --matrix --clean  # same on a clean machine: clones are fetched from the repositories
tools/validate_in_docker.sh --public          # public build without a profile, as an outsider would get it
tools/validate_in_docker.sh --reinstall       # plus a rerun, uninstall, and install after uninstall
```

With a fork package — `--openclaw-package <.tgz>` ([OpenClaw from a fork](../openclaw-fork.md)).

## Secret check before a commit

`tools/check-secrets.sh` runs [gitleaks](https://github.com/gitleaks/gitleaks) over the staged changes and
prints findings with values redacted. Enable it once per clone:

```bash
ln -s ../../tools/check-secrets.sh .git/hooks/pre-commit
```

A line that only looks like a secret (a test token on a bench) is skipped with a `gitleaks:allow` comment on
that line; a finding in text that cannot change goes to `.gitleaksignore` by its fingerprint.
