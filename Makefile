#!/usr/bin/env bash

include .env
export

COMPOSE=docker-compose
BACKUP_DIR=./backups
TIMESTAMP=$(shell date +%Y%m%d_%H%M%S)
POSTGRES_SERVICE=personal_secretary_postgres	# Warning: Using service_name, not container_name

db_backup:
	$(COMPOSE) exec -t $(POSTGRES_SERVICE) \
  pg_dump -U $(POSTGRES_USER) -d $(POSTGRES_DB) -Fc \
  > $(BACKUP_DIR)/$(POSTGRES_DB)_$(TIMESTAMP).dump

db_restore:
	@read -p "Restore file path name: " FILE; \
	if [ -z "$$FILE" ]; then \
		echo "File path is required."; exit 1; \
	fi; \
	if [ ! -f "$$FILE" ]; then \
		echo "File not found: $$FILE"; exit 1; \
	fi; \
	echo ""; \
	echo "Target database : $(POSTGRES_DB)"; \
	echo "Backup file     : $$FILE"; \
	echo ""; \
	read -p "This will WIPE database '$(POSTGRES_DB)'. Continue? [y/N] " ans; \
	if [ "$$ans" != "y" ]; then \
		echo "Operation cancelled."; exit 1; \
	fi; \
	echo ""; \
	echo "Restoring database..."; \
	$(COMPOSE) exec -T $(POSTGRES_SERVICE) \
	pg_restore -U $(POSTGRES_USER) -d $(POSTGRES_DB) \
	--clean --if-exists < "$$FILE"; \
	echo ""; \
	echo "Restore completed successfully.\n";

build_up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down
