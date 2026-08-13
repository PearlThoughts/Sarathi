import type { CollectionConfig } from "payload";
import { STUDIO_USER_COLLECTION_SLUG } from "../domain/studio-session";
import { rememberLoginHandler } from "../server/remember-login-handler";

export const StudioUsers: CollectionConfig = {
  slug: STUDIO_USER_COLLECTION_SLUG,
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
  endpoints: [
    {
      path: "/remember-login",
      method: "post",
      handler: rememberLoginHandler,
    },
  ],
};
