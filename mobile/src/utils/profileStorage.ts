import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppLanguage } from "../i18n";

const PROFILE_STORAGE_KEY = "digital_human.user_profile";

export type UserProfile = {
  autoPlayVoice: boolean;
  birthDate: string;
  birthPlace: string;
  birthTime: string;
  darkMode: boolean;
  gender: string;
  language: AppLanguage;
  name: string;
  notes: string;
};

export const emptyUserProfile: UserProfile = {
  autoPlayVoice: false,
  birthDate: "",
  birthPlace: "",
  birthTime: "",
  darkMode: false,
  gender: "",
  language: "zh",
  name: "",
  notes: "",
};

export async function loadUserProfile() {
  const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) {
    return emptyUserProfile;
  }

  const parsed = JSON.parse(raw) as Partial<UserProfile>;
  const language = parsed.language === "en" || parsed.language === "zh" ? parsed.language : "zh";
  return {
    ...emptyUserProfile,
    ...parsed,
    language,
  };
}

export async function saveUserProfile(profile: UserProfile) {
  await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function formatUserProfileForPrompt(profile: UserProfile) {
  const parts = [
    profile.name ? `姓名:${profile.name}` : "",
    profile.gender ? `性别:${profile.gender}` : "",
    profile.birthDate ? `出生日期:${profile.birthDate}` : "",
    profile.birthTime ? `出生时间:${profile.birthTime}` : "",
    profile.birthPlace ? `出生地:${profile.birthPlace}` : "",
    profile.notes ? `补充:${profile.notes}` : "",
  ].filter(Boolean);

  if (!parts.length) {
    return "";
  }

  return [
    "以下是用户在个人设置中保存的长期资料。回答时请自然参考这些信息，尤其是八字、事业、感情、流年等个人化问题；不要主动说明这段资料来自系统拼接，除非用户询问。",
    `用户个人资料: ${parts.join("; ")}`,
  ].join("\n");
}
