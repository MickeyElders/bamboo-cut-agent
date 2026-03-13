.PHONY: help backend-venv backend-install backend-update backend-run frontend-install frontend-update frontend-build frontend-run canmv-tail deploy install-service install-frontend-service service-status service-restart service-logs frontend-service-status frontend-service-restart frontend-service-logs

SHELL := /bin/bash

PY ?= python3
VENV := backend/.venv
PYBIN := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

SERIAL ?= /dev/serial/by-id/usb-Kendryte_CanMV_001000000-if00
API_HOST ?= 0.0.0.0
API_PORT ?= 8000
SERVICE ?=
SERVICE_FILE ?= bamboo-backend.service
FRONTEND_SERVICE ?=
FRONTEND_SERVICE_FILE ?= bamboo-frontend.service

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
	@echo "  install-service  Install systemd backend service"
	@echo "  install-frontend-service Install systemd frontend service"
	@echo "  service-status   Show backend service status"
	@echo "  service-restart  Restart backend service"
	@echo "  service-logs     Tail backend service logs"
	@echo "  frontend-service-status  Show frontend service status"
	@echo "  frontend-service-restart Restart frontend service"
	@echo "  frontend-service-logs    Tail frontend service logs"

backend-venv:
	$(PY) -m venv --system-site-packages $(VENV)

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

frontend-build: frontend-install
	cd frontend && npm run build

frontend-run:
	cd frontend && npm run dev

canmv-tail:
	cat $(SERIAL)

deploy:
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
	@if [ -n "$(FRONTEND_SERVICE)" ]; then \
		if systemctl list-unit-files | grep -q "^$(FRONTEND_SERVICE)"; then \
			sudo systemctl restart "$(FRONTEND_SERVICE)"; \
		else \
			echo "Skip restart: systemd unit $(FRONTEND_SERVICE) not found"; \
		fi; \
	fi

install-service:
	@if [ ! -f systemd/bamboo.env ]; then cp systemd/bamboo.env.example systemd/bamboo.env; fi
	sudo cp systemd/$(SERVICE_FILE) /etc/systemd/system/$(SERVICE_FILE)
	sudo systemctl daemon-reload
	sudo systemctl enable $(SERVICE_FILE)
	sudo systemctl restart $(SERVICE_FILE)

install-frontend-service:
	@if [ ! -f systemd/bamboo.env ]; then cp systemd/bamboo.env.example systemd/bamboo.env; fi
	sudo cp systemd/$(FRONTEND_SERVICE_FILE) /etc/systemd/system/$(FRONTEND_SERVICE_FILE)
	sudo systemctl daemon-reload
	sudo systemctl enable $(FRONTEND_SERVICE_FILE)
	sudo systemctl restart $(FRONTEND_SERVICE_FILE)

service-status:
	sudo systemctl status $(SERVICE_FILE) --no-pager

service-restart:
	sudo systemctl reset-failed $(SERVICE_FILE) || true
	sudo systemctl restart $(SERVICE_FILE)

service-logs:
	sudo journalctl -u $(SERVICE_FILE) -f

frontend-service-status:
	sudo systemctl status $(FRONTEND_SERVICE_FILE) --no-pager

frontend-service-restart:
	sudo systemctl reset-failed $(FRONTEND_SERVICE_FILE) || true
	sudo systemctl restart $(FRONTEND_SERVICE_FILE)

frontend-service-logs:
	sudo journalctl -u $(FRONTEND_SERVICE_FILE) -f
