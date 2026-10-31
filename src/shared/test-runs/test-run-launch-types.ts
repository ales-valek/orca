/** What a run is pointed at: a local Dev Environment, or a named shared preset. */
export type TestRunTarget = { kind: 'dev-env'; devEnvId: string } | { kind: 'preset'; name: string }
