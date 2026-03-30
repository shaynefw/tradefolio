export const COOKIE_NAME = "tradefolio_session";
export const JWT_EXPIRY = "7d";

export const ERROR_MESSAGES = {
  UNAUTHORIZED: "Not authenticated",
  FORBIDDEN: "Not authorized",
  NOT_FOUND: "Not found",
  ACCOUNT_LIMIT: "Account limit reached",
  TRADE_LIMIT: "Trade limit reached",
  TAG_LIMIT: "Tag limit reached",
  STRATEGY_LIMIT: "Strategy limit reached",
  INVALID_CREDENTIALS: "Invalid email or password",
  EMAIL_IN_USE: "Email already in use",
} as const;
