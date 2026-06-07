/**
 * Container release version, stamped into export manifests as
 * `container_version` (.WFenvirSnapshot and .WFenvirBundleX).
 *
 * Kept as a source constant rather than a package.json read because the
 * Docker image runs the server as a single esbuild bundle (server.mjs) with
 * no package.json alongside. Bump together with the suite version in the
 * root package.json.
 */
export const CONTAINER_VERSION = '2.1.1'
