# Required private AI Hub image, supplied by digest by the deployment workflow.
ARG IRIS_IMAGE
FROM ${IRIS_IMAGE}
USER 0
RUN install -d -o 51773 -g 51773 -m 0750 /data
ENV PYTHONDONTWRITEBYTECODE=1 \
    ISC_DATA_DIRECTORY=/data/kotr-native \
    KOTR_CLOUD_SEAT_PASSWORD_FILE=/data/kotr-cloud/seat-password \
    KOTR_CLOUD_ASSETS=/opt/kotr-cloud/demo \
    KOTR_CLOUD_PROVIDER_MODE=replay \
    KNAIGHTS_LIVE=1 \
    KNAIGHTS_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1
# Keep this explicit slice aligned with the qualified default core inventory.
COPY --chown=51773:51773 \
    src/KnAIghts/Review/App.cls \
    src/KnAIghts/Review/Cases.cls \
    src/KnAIghts/Review/CodexMCP.cls \
    src/KnAIghts/Review/CodexPolicy.cls \
    src/KnAIghts/Review/CodexTools.cls \
    src/KnAIghts/Review/Operation.cls \
    src/KnAIghts/Review/Production.cls \
    src/KnAIghts/Review/Request.cls \
    src/KnAIghts/Review/Response.cls \
    src/KnAIghts/Review/Service.cls \
    src/KnAIghts/Review/SyntheticTask.cls \
    src/KnAIghts/Review/Tools.cls \
    /opt/knaights/src/KnAIghts/Review/
COPY --chown=51773:51773 cloud/native/Api.cls cloud/native/State.cls /opt/knaights/cloud/
COPY --chown=51773:51773 cloud/native/bootstrap.script /opt/kotr-cloud/bootstrap.script
COPY --chown=51773:51773 --chmod=0755 cloud/native/start.sh /opt/kotr-cloud/start.sh
COPY --chown=51773:51773 --chmod=0755 cloud/native/create.sh /opt/kotr-cloud/create.sh
COPY --chown=51773:51773 cloud/native/broker.py cloud/native/provider.py cloud/native/provider-fixtures.json /opt/kotr-cloud/
COPY --chown=51773:51773 cloud/native/index.html cloud/native/demo.js /opt/kotr-cloud/demo/
COPY --chown=51773:51773 demo/demo.css /opt/kotr-cloud/demo/demo.css
COPY --chown=51773:51773 LICENSE NOTICE THIRD_PARTY_NOTICES.md /opt/kotr-cloud/notices/
USER 51773:51773
EXPOSE 8080
CMD ["--instance", "IRIS", "--check-caps", "false", "--create", "/opt/kotr-cloud/create.sh", "--password-file", "/data/kotr-cloud/bootstrap-password", "--after", "/opt/kotr-cloud/start.sh"]
