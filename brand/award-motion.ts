import { mount } from "svelte";
import "../src/client/styles.css";
import AwardDemo from "./AwardDemo.svelte";

const target = document.querySelector("#award-demo");
if (!target) throw new Error("The award preview mount is missing.");
mount(AwardDemo, { target });
