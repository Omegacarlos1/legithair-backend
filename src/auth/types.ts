export type Role = 'customer' | 'seller' | 'admin' | 'finance';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  roles: Role[];
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
