from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4.1-mini",
    messages=[
        {"role": "user", "content": "用3句话解释什么是ai agent."}
    ]
)
print(response.choices[0].message.content)