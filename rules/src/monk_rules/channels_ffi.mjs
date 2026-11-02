import { Result$Ok, Result$Error } from "../gleam.mjs";

export function parse(text) {
  try {
    return Result$Ok(JSON.parse(text));
  } catch (error) {
    return Result$Error(String(error));
  }
}
