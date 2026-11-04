.PHONY: install ci test lint fmt build
install:
	pnpm install --frozen-lockfile
build:
	pnpm build
test:
	pnpm test
lint:
	pnpm lint
fmt:
	pnpm exec prettier --write .
ci: lint build test
	git diff --exit-code plugin/bin/orgdown.mjs
