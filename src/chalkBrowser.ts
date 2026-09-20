type ChalkFormatter = (...values: unknown[]) => string;

const format: ChalkFormatter = (...values) => values.map(String).join(" ");

const chalk = new Proxy(format, {
  get: () => chalk,
});

export default chalk;
