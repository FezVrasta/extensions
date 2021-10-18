import {
    preferences,
} from "@raycast/api";
import { Connection, createConnection, createLongLivedTokenAuth } from "home-assistant-js-websocket";
import { HomeAssistant } from "./haapi";

export function createHomeAssistantClient() {
    const instance = preferences.instance?.value as string;
    const token = preferences.token?.value as string;
    const ha = new HomeAssistant(instance, token);
    return ha;
}

var con: Connection;

export async function getHAWSConnection() {
    if (con) {
        console.log("return existing ws con");
        return con;
    } else {
        console.log("create new home assistant ws con");
        const instance = preferences.instance?.value as string;
        const token = preferences.token?.value as string;
        const auth = createLongLivedTokenAuth(instance, token);
        con = await createConnection({ auth });
        return con;
    }
}
