// Developer fixtures for the sample monitoring package. Not published to the
// sample repositories; the runtime bundle reads the real files from a checkout.
import { monitoringInventoryText } from "./application-build.mjs";
import { sampleFiles } from "./fixtures.mjs";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const monitoringAlarms = () => [
  { metric: "Errors", threshold: 1 },
  { metric: "Throttles", threshold: 5 }
];
// Hand-edited alarms, a controlled deployment switch, and the committed
// inventory generated from the sample catalog.
export const monitoringFiles = ({
  alarms = monitoringAlarms(),
  failEnvironment = null,
  catalog = JSON.parse(sampleFiles().backend["src/config/deploy-services.json"])
} = {}) => ({
  "ops/monitoring/src/alarms.json": json({ alarms }),
  "ops/monitoring/src/deploy.json": json({ fail_environment: failEnvironment }),
  "ops/monitoring/monitoring-prod.json": monitoringInventoryText(
    catalog,
    alarms,
    "prod"
  ),
  "ops/monitoring/monitoring-staging.json": monitoringInventoryText(
    catalog,
    alarms,
    "staging"
  )
});
