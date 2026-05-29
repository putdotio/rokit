#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { mainEffect } from "./cli.js";

NodeRuntime.runMain(mainEffect().pipe(Effect.provide(NodeServices.layer)));
