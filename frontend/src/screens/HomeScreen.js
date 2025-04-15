// frontend/src/screens/HomeScreen.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";

// 🔧 BACKEND CONFIG — be sure to update with your local IP!
const BACKEND_URL = "http://10.0.1.141:4000"; // 👈 UPDATE THIS
const AUTH_HEADER = { Authorization: "Bearer super_secret" };

export default function HomeScreen() {
  // 🔄 App state
  const [symbol, setSymbol] = useState("BTCUSD");
  const [availableCryptos, setAvailableCryptos] = useState([]);
  const [price, setPrice] = useState(null);
  const [mode, setMode] = useState("demo");
  const [amount, setAmount] = useState("");
  const [tradesLeft, setTradesLeft] = useState(50);

  // 🔄 Fetch available symbols from backend
  const fetchCryptos = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/cryptos`, {
        headers: AUTH_HEADER,
      });
      setAvailableCryptos(res.data || []);
      if (!res.data.includes(symbol)) {
        setSymbol(res.data[0] || "BTCUSD");
      }
    } catch (err) {
      console.error("Error fetching cryptos:", err.message);
    }
  };

  // 🔄 Fetch live market price for selected symbol
  const fetchPrice = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/price/${symbol}`, {
        headers: AUTH_HEADER,
      });
      setPrice(res.data.price);
    } catch (err) {
      console.error("Price fetch failed:", err.message);
    }
  };

  // 🔄 Fetch trade summary (24h trades remaining)
  const fetchTradeSummary = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/trades/summary`, {
        headers: AUTH_HEADER,
      });
      setTradesLeft(res.data.remaining);
    } catch (err) {
      console.error("Trade summary failed:", err.message);
    }
  };

  // 💰 Handle Buy/Sell
  const handleTrade = async (side) => {
    if (!amount || isNaN(amount)) {
      return Alert.alert("Invalid Input", "Please enter a valid amount.");
    }

    try {
      const res = await axios.post(
        `${BACKEND_URL}/trade`,
        {
          symbol,
          side,
          amount: parseFloat(amount),
          mode,
        },
        { headers: AUTH_HEADER }
      );
      Alert.alert(
        "Trade Success",
        `${side.toUpperCase()} ${symbol} at $${res.data.price}`
      );
      fetchTradeSummary();
    } catch (err) {
      console.error("Trade failed:", err.message);
      Alert.alert("Trade Error", err.response?.data?.error || "Unknown error");
    }
  };

  // ⏱ On startup and interval
  useEffect(() => {
    fetchCryptos();
    fetchTradeSummary();
  }, []);

  useEffect(() => {
    fetchPrice();
    const interval = setInterval(fetchPrice, 10000);
    return () => clearInterval(interval);
  }, [symbol]);

  // 🖼 UI
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>AutoTradePro Crypto</Text>
      <Text style={styles.label}>Mode: {mode.toUpperCase()}</Text>

      {/* 🔽 Symbol Picker */}
      <Picker
        selectedValue={symbol}
        style={styles.picker}
        onValueChange={(itemValue) => setSymbol(itemValue)}
      >
        {availableCryptos.map((sym) => (
          <Picker.Item key={sym} label={sym} value={sym} />
        ))}
      </Picker>

      <Text style={styles.label}>
        {symbol}: ${price || "Loading..."}
      </Text>

      <Text style={styles.label}>Trades Remaining (24h): {tradesLeft}</Text>

      {/* 🔁 Mode Toggle */}
      <Button
        title={`Switch to ${mode === "demo" ? "Live" : "Demo"} Mode`}
        onPress={() => setMode(mode === "demo" ? "live" : "demo")}
      />

      {/* 💲 Amount Entry */}
      <TextInput
        placeholder="Amount in USD"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        style={styles.input}
      />

      {/* 🔘 Action Buttons */}
      <View style={styles.buttonRow}>
        <Button title="Buy" onPress={() => handleTrade("buy")} />
        <Button title="Sell" onPress={() => handleTrade("sell")} />
      </View>
    </ScrollView>
  );
}

// 🎨 Styles
const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
  },
  picker: {
    height: 50,
    width: 200,
    marginBottom: 12,
  },
  input: {
    height: 40,
    width: "60%",
    borderColor: "#ccc",
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "space-around",
    marginTop: 10,
  },
});
