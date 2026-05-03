import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";

type Props = {
  busy?: boolean;
  disabled?: boolean;
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
};

export function Composer({ busy, disabled, value, onChangeText, onSend }: Props) {
  const canSend = value.trim().length > 0 && !disabled;

  return (
    <View style={styles.container}>
      <TextInput
        multiline
        editable={!disabled}
        value={value}
        onChangeText={onChangeText}
        placeholder={busy ? "大师正在推演..." : "问问陈大师..."}
        placeholderTextColor="#927f67"
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!canSend}
        onPress={onSend}
        style={[styles.button, !canSend && styles.buttonDisabled]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Ionicons name="send" size={19} color="#ffffff" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-end",
    backgroundColor: "#fffaf3",
    borderColor: "#e4d7c6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 8,
  },
  input: {
    color: "#2b261f",
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 110,
    minHeight: 42,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  button: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
  },
  buttonDisabled: {
    backgroundColor: "#bcae9b",
  },
});
