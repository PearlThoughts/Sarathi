"use client";

import { useEffect } from "react";

export const ProductStudioLoginRedirect = ({ target }: { readonly target: string }) => {
  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <main className="grid min-h-dvh place-items-center bg-stone-100 p-8 text-stone-950">
      <section
        aria-labelledby="product-studio-sign-in"
        className="max-w-md rounded-xl border border-stone-300 bg-white p-7 shadow-sm"
      >
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-800">
          Sarathi / Product Studio
        </p>
        <h1 className="mt-2 text-balance text-2xl font-semibold" id="product-studio-sign-in">
          Continuing to secure sign-in
        </h1>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-stone-700" role="status">
          You will return to the same Product Map view after authentication.
        </p>
        <a
          className="mt-5 inline-flex rounded-md bg-teal-800 px-4 py-2 font-semibold text-white shadow-sm hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          href={target}
        >
          Continue to sign in
        </a>
      </section>
    </main>
  );
};
