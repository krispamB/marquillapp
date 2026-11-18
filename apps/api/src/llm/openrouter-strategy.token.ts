/** Injection token for the OpenRouter strategy. A symbol so the factory does not import the strategy class, which imports `@openrouter/sdk`. */
export const OPENROUTER_STRATEGY = Symbol('OPENROUTER_STRATEGY');
