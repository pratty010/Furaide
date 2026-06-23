const SINK_PREFIX = "[web-tools]";

export function errorSink(context: string): (err: unknown) => void {
  return (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${SINK_PREFIX} ${context}: ${message}`);
  };
}
