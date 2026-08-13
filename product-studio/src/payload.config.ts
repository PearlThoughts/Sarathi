import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";
import { StudioUsers } from "./collections/StudioUsers";
import { migrations } from "./migrations";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

export default buildConfig({
  admin: {
    user: StudioUsers.slug,
    importMap: {
      baseDir: dirname,
      importMapFile: path.resolve(dirname, "app/(payload)/admin/importMap.ts"),
    },
    components: {
      views: {
        login: {
          Component: "/views/RememberLoginView#RememberLoginView",
        },
        dashboard: {
          Component: "/views/ProductMapView#ProductMapView",
        },
        productMap: {
          Component: "/views/ProductMapView#ProductMapView",
          path: "/product-map",
        },
      },
    },
    meta: {
      titleSuffix: " — Sarathi Product Studio",
    },
  },
  collections: [StudioUsers],
  db: postgresAdapter({
    pool: {
      connectionString: required(
        "PRODUCT_STUDIO_DATABASE_URL",
        process.env.PRODUCT_STUDIO_DATABASE_URL,
      ),
    },
    idType: "uuid",
    migrationDir: path.resolve(dirname, "migrations"),
    prodMigrations: migrations,
    push: false,
    schemaName: "product_studio",
  }),
  secret: required("PAYLOAD_SECRET", process.env.PAYLOAD_SECRET),
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});
