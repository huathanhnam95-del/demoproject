import asyncio
import edge_tts
import edge_tts.communicate

async def test_raw_ssml():
    def custom_mkssml(tc, escaped_text):
        if isinstance(escaped_text, bytes):
            escaped_text = escaped_text.decode('utf-8')
        unescaped = escaped_text.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"').replace('&apos;', "'")
        return (
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>"
            f"<voice name='{tc.voice}'>"
            f"<prosody pitch='{tc.pitch}' rate='{tc.rate}' volume='{tc.volume}'>"
            f"{unescaped}"
            "</prosody>"
            "</voice>"
            "</speak>"
        )
    edge_tts.communicate.mkssml = custom_mkssml

    # Test 1: <lang xml:lang='en-US'>
    text1 = "Ví dụ trong từ: <lang xml:lang='en-US'>happen</lang>."
    comm1 = edge_tts.Communicate(text1, 'vi-VN-NamMinhNeural')
    try:
        await comm1.save('workspace_rachel_voiceover/test_ssml_lang.mp3')
        print('Test 1 (<lang>): SUCCESS')
    except Exception as e:
        print('Test 1 (<lang>): FAILED ->', e)

    # Test 2: <phoneme>
    # happen: /ˈhæp.ən/
    text2 = "Ví dụ trong từ: <phoneme alphabet='ipa' ph='ˈhæp.ən'>happen</phoneme>."
    comm2 = edge_tts.Communicate(text2, 'vi-VN-NamMinhNeural')
    try:
        await comm2.save('workspace_rachel_voiceover/test_ssml_phoneme.mp3')
        print('Test 2 (<phoneme>): SUCCESS')
    except Exception as e:
        print('Test 2 (<phoneme>): FAILED ->', e)

    # Test 3: voice switching inside SSML
    ssml_voice = (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>"
        "<voice name='vi-VN-NamMinhNeural'>Ví dụ trong từ: </voice>"
        "<voice name='en-US-GuyNeural'>happen</voice>"
        "<voice name='vi-VN-NamMinhNeural'>.</voice>"
        "</speak>"
    )
    def custom_mkssml3(tc, escaped_text):
        return ssml_voice
    edge_tts.communicate.mkssml = custom_mkssml3
    comm3 = edge_tts.Communicate("dummy", 'vi-VN-NamMinhNeural')
    try:
        await comm3.save('workspace_rachel_voiceover/test_ssml_multi_voice.mp3')
        print('Test 3 (multi-voice SSML): SUCCESS')
    except Exception as e:
        print('Test 3 (multi-voice SSML): FAILED ->', e)

if __name__ == '__main__':
    asyncio.run(test_raw_ssml())
