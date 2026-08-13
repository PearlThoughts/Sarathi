import { redirect } from "next/navigation";
import type { AdminViewServerProps } from "payload";
import { getSafeRedirect } from "payload/shared";
import { RememberLoginForm } from "./RememberLoginForm";

export const RememberLoginView = ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const { req } = initPageResult;
  const adminRoute = req.payload.config.routes.admin;
  const redirectUrl = getSafeRedirect({
    fallbackTo: adminRoute,
    redirectTo: searchParams?.redirect ?? adminRoute,
  });

  if (req.user) redirect(redirectUrl);

  return (
    <>
      <div className="login__brand remember-login__brand">
        <span className="remember-login__brand-mark">Sarathi</span>
        <span className="remember-login__brand-context">Product Studio</span>
      </div>
      <RememberLoginForm searchParams={searchParams ?? {}} />
    </>
  );
};
