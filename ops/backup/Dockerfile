# syntax=docker/dockerfile:1.7
# RADAR backup container: the mysql 8.4 client tools (same version as the server) + git/ssh.
# Runs ops/backup/scheduler.sh forever; one-off jobs:
#   docker compose exec backup radar-backup-scheduler run-now backup
#   docker compose exec backup radar-restore --yes-i-know        (see docs/RECOVERY.md)
ARG MYSQL_IMAGE=mysql:8.4
FROM ${MYSQL_IMAGE}

# gzip, openssl and findutils ship with the image; install whatever else is missing.
RUN set -eux; \
    pkgs="git-core openssh-clients"; \
    for c in gzip:gzip openssl:openssl find:findutils sed:sed grep:grep od:coreutils-single split:coreutils-single curl:curl-minimal; do \
      command -v "${c%%:*}" >/dev/null 2>&1 || pkgs="$pkgs ${c#*:}"; \
    done; \
    microdnf install -y --nodocs --setopt=install_weak_deps=0 $pkgs; \
    microdnf clean all; \
    rm -rf /var/cache/dnf /var/cache/yum; \
    git --version; ssh -V; mysqldump --version; openssl version; curl --version | head -n 1

ENV RADAR_BACKUP_HOME=/opt/radar-backup \
    BACKUP_KNOWN_HOSTS=/etc/radar-backup/github_known_hosts \
    BACKUP_WORK_DIR=/work \
    TZ=UTC

COPY --chmod=0644 github_known_hosts /etc/radar-backup/github_known_hosts
COPY --chmod=0644 lib.sh /opt/radar-backup/lib.sh
COPY --chmod=0755 backup.sh restore.sh restore-test.sh scheduler.sh radar-alert.sh /opt/radar-backup/

# COPY --chmod also applies to the directories BuildKit creates for the destination, leaving them
# 0644 (no x bit). With `cap_drop: ALL` nothing can traverse them, so tini fails with EACCES.
RUN set -eux; \
    chmod 0755 /opt/radar-backup /etc/radar-backup; \
    ln -s /opt/radar-backup/backup.sh /usr/local/bin/radar-backup; \
    ln -s /opt/radar-backup/restore.sh /usr/local/bin/radar-restore; \
    ln -s /opt/radar-backup/restore-test.sh /usr/local/bin/radar-restore-test; \
    ln -s /opt/radar-backup/scheduler.sh /usr/local/bin/radar-backup-scheduler; \
    ln -s /opt/radar-backup/radar-alert.sh /usr/local/bin/radar-alert; \
    mkdir -p /work; \
    for s in /opt/radar-backup/*.sh; do bash -n "$s"; done; \
    radar-backup-scheduler next-slots 0 >/dev/null; \
    for s in radar-backup radar-restore radar-restore-test radar-alert; do "$s" --help >/dev/null; done

WORKDIR /work
LABEL com.radar.project="radar" \
      org.opencontainers.image.title="radar-backup" \
      org.opencontainers.image.description="Encrypted MySQL backups of RADAR to the db-backups branch"

# Replace the mysql server entrypoint: this image never runs mysqld.
ENTRYPOINT []
CMD ["radar-backup-scheduler"]
