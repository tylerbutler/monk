import "./styles.css";
import { mountApp } from "./app";

const root = document.getElementById("app");
if (!root) throw new Error("Monk application root is missing.");
mountApp(root);
