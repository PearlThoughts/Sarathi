"use client";

import {
  CheckboxField,
  EmailField,
  Form,
  FormSubmit,
  Link,
  PasswordField,
  useAuth,
  useConfig,
  useTranslation,
} from "@payloadcms/ui";
import { email, formatAdminURL, getSafeRedirect } from "payload/shared";

type SearchParams = Record<string, string | string[] | undefined>;

export const RememberLoginForm = ({ searchParams }: { readonly searchParams: SearchParams }) => {
  const { config } = useConfig();
  const { setUser } = useAuth();
  const { t } = useTranslation();
  const { admin: adminRoute, api: apiRoute } = config.routes;
  const { forgot: forgotRoute } = config.admin.routes;
  const userSlug = config.admin.user;
  const initialState = {
    email: { initialValue: undefined, valid: true, value: undefined },
    password: { initialValue: undefined, valid: true, value: undefined },
    remember: { initialValue: false, valid: true, value: false },
  };

  return (
    <Form
      action={formatAdminURL({ apiRoute, path: `/${userSlug}/remember-login` })}
      className="login__form remember-login__form"
      disableSuccessStatus
      initialState={initialState}
      method="POST"
      onSuccess={(data) => setUser(data as Parameters<typeof setUser>[0])}
      redirect={getSafeRedirect({
        fallbackTo: adminRoute,
        redirectTo: searchParams.redirect ?? adminRoute,
      })}
      waitForAutocomplete
    >
      <div className="login__form__inputWrap">
        <EmailField
          field={{
            name: "email",
            label: t("general:email"),
            required: true,
            admin: { autoComplete: "email" },
          }}
          path="email"
          validate={email}
        />
        <PasswordField
          autoComplete="current-password"
          field={{ name: "password", label: t("general:password"), required: true }}
          path="password"
        />
      </div>
      <div className="remember-login__choice">
        <CheckboxField
          field={{
            name: "remember",
            label: "Remember me",
            admin: {
              description: "Keep me signed in on this device for 365 days.",
            },
          }}
          path="remember"
        />
        <p className="remember-login__shared-device-note">
          Leave this unchecked on a shared device.
        </p>
      </div>
      <Link href={formatAdminURL({ adminRoute, path: forgotRoute })} prefetch={false}>
        {t("authentication:forgotPasswordQuestion")}
      </Link>
      <FormSubmit size="large">{t("authentication:login")}</FormSubmit>
    </Form>
  );
};
