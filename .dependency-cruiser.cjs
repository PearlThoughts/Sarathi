module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-kernel-is-pure",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(modules|infrastructure|platform)" },
    },
    {
      name: "modules-do-not-import-infrastructure",
      severity: "error",
      from: { path: "^src/modules" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "infrastructure-depends-on-module-ports-only",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: {
        path: "^src/modules",
        pathNot: "^src/modules/[^/]+/(ports/|index\\.ts$)",
      },
    },
    {
      name: "only-runtime-wires-infrastructure",
      severity: "error",
      from: { path: "^src/platform/(?!runtime\\.ts$)" },
      to: { path: "^src/infrastructure/" },
    },
    {
      name: "app-composes-module-public-apis-only",
      severity: "error",
      from: { path: "^src/app\\.ts$" },
      to: { path: "^src/modules/[^/]+/(api|application|domain|ports)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
  },
};
