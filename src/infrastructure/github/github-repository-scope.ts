export type GitHubRepositoryScope = {
  readonly owner: string;
  readonly ownerType: "org" | "user";
  readonly repositoryNamePrefix?: string | undefined;
};

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const validGitHubRepository = (repository: string): boolean =>
  repositoryPattern.test(repository);

export const validGitHubRepositoryScope = (scope: GitHubRepositoryScope): boolean =>
  ownerPattern.test(scope.owner) &&
  (scope.ownerType === "org" || scope.ownerType === "user") &&
  (scope.repositoryNamePrefix === undefined ||
    (/^[A-Za-z0-9_.-]+$/.test(scope.repositoryNamePrefix) &&
      scope.repositoryNamePrefix.length <= 100));

export const githubScopeQualifier = (scope: GitHubRepositoryScope): string =>
  `${scope.ownerType}:${scope.owner}`;

export const repositoryFromGitHubApiUrl = (value: string | undefined): string | undefined =>
  value?.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/)?.[1];

export const repositoryFromGitHubHtmlUrl = (value: string): string | undefined =>
  value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//)?.[1];

const githubRepositoryAllowed = (
  repository: string,
  allowedRepositories: readonly string[],
  repositoryScopes: readonly GitHubRepositoryScope[],
): boolean => {
  const [owner, name] = repository.split("/", 2);
  if (owner === undefined || name === undefined) return false;
  if (allowedRepositories.some((allowed) => allowed.toLowerCase() === repository.toLowerCase()))
    return true;
  return repositoryScopes.some(
    (scope) =>
      scope.owner.toLowerCase() === owner.toLowerCase() &&
      (scope.repositoryNamePrefix === undefined ||
        name.toLowerCase().startsWith(scope.repositoryNamePrefix.toLowerCase())),
  );
};

export const githubCodeRepositoryAllowed = (
  repository: string,
  allowedRepositories: readonly string[],
  repositoryScopes: readonly GitHubRepositoryScope[],
): boolean => {
  const name = repository.split("/", 2)[1];
  return (
    name !== undefined &&
    !name.toLowerCase().includes("vault") &&
    githubRepositoryAllowed(repository, allowedRepositories, repositoryScopes)
  );
};
