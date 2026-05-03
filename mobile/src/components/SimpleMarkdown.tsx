import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  text: string;
};

type InlinePart = {
  text: string;
  strong: boolean;
};

function parseInline(text: string) {
  const parts: InlinePart[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), strong: false });
    }
    parts.push({ text: match[1] ?? "", strong: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), strong: false });
  }

  return parts.length ? parts : [{ text, strong: false }];
}

function InlineText({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={[styles.text, style]}>
      {parseInline(text).map((part, index) => (
        <Text key={`${part.text}-${index}`} style={part.strong && styles.strong}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

export function SimpleMarkdown({ text }: Props) {
  const lines = text.split(/\r?\n/);

  return (
    <View>
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) {
          return <View key={index} style={styles.blankLine} />;
        }

        if (/^-{3,}$/.test(line)) {
          return <View key={index} style={styles.hr} />;
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
          const level = heading[1]?.length ?? 1;
          return (
            <InlineText
              key={index}
              text={heading[2] ?? ""}
              style={level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3}
            />
          );
        }

        const listItem = /^(\d+\.\s+|[-*+]\s+)(.+)$/.exec(line);
        if (listItem) {
          return (
            <View key={index} style={styles.listRow}>
              <Text style={styles.listMarker}>{/^\d/.test(listItem[1] ?? "") ? listItem[1] : "•"}</Text>
              <InlineText text={listItem[2] ?? ""} style={styles.listText} />
            </View>
          );
        }

        return (
          <Fragment key={index}>
            <InlineText text={line} style={styles.paragraph} />
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    color: "#2b261f",
    fontSize: 16,
    lineHeight: 23,
  },
  paragraph: {
    marginBottom: 8,
  },
  h1: {
    color: "#1f2528",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 28,
    marginBottom: 8,
  },
  h2: {
    color: "#1f2528",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 25,
    marginBottom: 7,
    marginTop: 4,
  },
  h3: {
    color: "#1f2528",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 23,
    marginBottom: 5,
    marginTop: 4,
  },
  strong: {
    color: "#1f2528",
    fontWeight: "800",
  },
  blankLine: {
    height: 6,
  },
  hr: {
    backgroundColor: "#e8ded0",
    height: 1,
    marginBottom: 10,
    marginTop: 6,
  },
  listRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginBottom: 5,
  },
  listMarker: {
    color: "#7b6b57",
    fontSize: 16,
    lineHeight: 23,
    minWidth: 26,
  },
  listText: {
    flex: 1,
    marginBottom: 0,
  },
});
