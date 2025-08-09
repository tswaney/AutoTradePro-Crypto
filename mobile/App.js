import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// Screens
import BotHub from "./src/screens/BotHub";
import Logs from "./src/screens/Logs";
import PortfolioSummary from "./src/screens/PortfolioSummary";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="BotHub" screenOptions={{ headerBackTitle: "Back" }}>
        <Stack.Screen name="BotHub" component={BotHub} options={{ title: "Bots" }} />
        <Stack.Screen name="Logs" component={Logs} options={({ route }) => ({ title: route?.params?.title || "Bot Logs" })} />
        <Stack.Screen name="PortfolioSummary" component={PortfolioSummary} options={({ route }) => ({ title: route?.params?.title || "Portfolio Summary" })} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
