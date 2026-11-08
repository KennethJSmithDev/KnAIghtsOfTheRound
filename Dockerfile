ARG IRIS_IMAGE=docker.iscinternal.com/docker-intersystems/intersystems/irishealth-community:2026.3.0AI.154.0
FROM ${IRIS_IMAGE}
COPY --chown=51773:51773 src/ /opt/knaights/src/
COPY --chown=51773:51773 --chmod=0755 docker/bootstrap.sh /opt/knaights/bootstrap.sh
COPY --chown=51773:51773 docker/bootstrap.script /opt/knaights/bootstrap.script
COPY --chown=51773:51773 LICENSE NOTICE /opt/knaights/
