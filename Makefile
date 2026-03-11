.PHONY: help backend-venv backend-install backend-update backend-run frontend-install frontend-update frontend-build frontend-run canmv-tail deploy

SHELL := /bin/bash

PY ?= python3
VENV := backend/.venv
PYBIN := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

SERIAL ?= /dev/serial/by-id/usb-Kendryte_CanMV_001000000-if00
API_HOST ?= 0.0.0.0
API_PORT ?= 8000
SERVICE ?=

help:
	@echo "Targets:"
	@echo "  backend-venv     Create backend venv"
	@echo "  backend-install  Install backend deps"
	@echo "  backend-update   Update backend deps"
	@echo "  backend-run      Run FastAPI server"
	@echo "  frontend-install Install frontend deps"
	@echo "  frontend-update  Update frontend deps"
	@echo "  frontend-build   Build frontend"
	@echo "  frontend-run     Run frontend dev server"
	@echo "  canmv-tail       Tail CanMV serial output"
	@echo "  deploy           Pull updates, update deps, rebuild frontend"

backend-venv:
	$(PY) -m venv $(VENV)

backend-install: backend-venv
	$(PIP) install -r backend/requirements.txt

backend-update: backend-venv
	$(PIP) install -U -r backend/requirements.txt

backend-run: backend-install
	CANMV_SERIAL_PORT=$(SERIAL) CANMV_BAUDRATE=115200 $(PYBIN) -m uvicorn backend.app.main:app --host $(API_HOST) --port $(API_PORT) --reload

frontend-install:
	cd frontend && if [ -f package-lock.json ]; then npm install; else npm install; fi

frontend-update:
	cd frontend && npm update

frontend-build:
	cd frontend && npm run build

frontend-run:
	cd frontend && npm run dev

canmv-tail:
	cat $(SERIAL)

deploy:
	git -C . pull
	$(MAKE) backend-update
	$(MAKE) frontend-update
	$(MAKE) frontend-build
	@if [ -n "$(SERVICE)" ]; then \
		if systemctl list-unit-files | grep -q "^$(SERVICE)"; then \
			sudo systemctl restart "$(SERVICE)"; \
		else \
			echo "Skip restart: systemd unit $(SERVICE) not found"; \
		fi; \
	fi
