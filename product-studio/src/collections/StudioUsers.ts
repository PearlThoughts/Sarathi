import type { CollectionConfig } from "payload";

export const StudioUsers: CollectionConfig = {
  slug: "studio-users",
  auth: true,
  admin: {
    useAsTitle: "email",
  },
  fields: [
    {
      name: "displayName",
      type: "text",
      required: true,
    },
  ],
};
