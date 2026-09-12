export type DataSensitivityLevel = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export interface ConnectorSecurityDescriptor {
  readOnly: boolean;
  requiresNetwork: boolean;
  requiresAuthentication: boolean;
  requiredPermissions: string[];
  sensitivityLevel: DataSensitivityLevel;
  allowedProtocols?: string[];
  ssrfProtected?: boolean;
}

export const DEFAULT_READ_ONLY_SECURITY: ConnectorSecurityDescriptor = {
  readOnly: true,
  requiresNetwork: false,
  requiresAuthentication: false,
  requiredPermissions: ['read'],
  sensitivityLevel: 'INTERNAL',
  ssrfProtected: true,
};
