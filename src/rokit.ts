#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { mainEffect } from "./cli.js";

NodeRuntime.runMain(mainEffect());
