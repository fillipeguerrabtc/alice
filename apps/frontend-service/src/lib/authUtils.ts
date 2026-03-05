export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

export function hasPermission(
  permissions: string[] | undefined | null,
  requiredPermission: string,
  userRoles?: string[] | null
): boolean {
  const normalizedRoles = Array.isArray(userRoles) ? userRoles : [];
  if (normalizedRoles.includes('admin') || normalizedRoles.includes('super_admin')) {
    return true;
  }

  if (!Array.isArray(permissions) || permissions.length === 0) {
    return false;
  }

  if (permissions.includes(requiredPermission)) {
    return true;
  }

  // Regra enterprise: `module:resource:manage` cobre `module:resource:*`
  const requiredParts = requiredPermission.split(':');
  if (requiredParts.length === 3) {
    const [moduleName, resourceName] = requiredParts;
    const managePermission = `${moduleName}:${resourceName}:manage`;
    return permissions.includes(managePermission);
  }

  return false;
}
