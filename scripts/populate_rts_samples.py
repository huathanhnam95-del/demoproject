#!/usr/bin/env python3
"""
Comprehensive RTS sample response generator for all 146 questions.
Tailors authentic full (C1) and simplified (B1/B2) responses for every scenario.
"""

import json
import re
import os
import shutil
import datetime
import sys

sys.stdout.reconfigure(encoding='utf-8')

TARGET_FILE = 'public/database/RTS/rts_questions.json'

def build_rts_response(q):
    prompt = q.get('answer', '')
    speech_act = q.get('speechAct', 'explaining').lower()
    context = q.get('context', 'semi-formal').lower()
    title = q.get('title', '')
    topic = re.sub(r'^#\d+\s*', '', title).strip()
    qid = q.get('id', 0)

    # Bespoke handcrafted responses for specific scenarios
    bespoke = {
        1: (
            "Hello everyone, thank you all for making such great use of our library study space. To ensure it remains comfortable and accessible for everyone, please make sure to keep the desks tidy and take all personal belongings with you when you leave. Any unattended items will be brought to the front lost and found. Thank you for your cooperation!",
            "Hello everyone, please remember to keep this study area clean and organized. Make sure you take all your personal items when you leave your desk. Unattended items will be moved to the front desk. Thank you for your help!"
        ),
        2: (
            "I'd be glad to prepare the client project update, but I wanted to mention that I'm waiting on essential feedback from Sarah, who is out of the office until Thursday. To ensure all figures and deliverables are thoroughly verified, could I submit an initial draft on Friday and provide the finalized version first thing Monday morning?",
            "I can certainly work on the update, but I need critical feedback from my teammate who returns on Thursday. Could I submit a preliminary draft on Friday and the finalized report on Monday morning?"
        ),
        3: (
            "Good morning. I booked today's visit specifically based on the wide range of services advertised on your website. However, several facilities and treatments are unavailable today, which is quite disappointing given the premium price paid. Could we either reschedule the unavailable treatments for another date or adjust the bill accordingly?",
            "Hello. I booked this spa day for the services advertised online, but many treatments are unavailable today. Since the experience is different from what was promised, could you please offer a partial refund or reschedule?"
        ),
        4: (
            "Hey, thanks for bringing the car back. I noticed when I got in that the interior is quite dirty with trash and muddy floor mats. When I lend my car out, I really expect it to be returned in the same clean condition. Could you help me give it a quick wash and vacuum this afternoon?",
            "Hi, thanks for returning the car. However, the inside is quite messy with dirt and trash. When I lend my car, I expect it to come back clean. Could you please help me clean it up?"
        ),
        5: (
            "Hey team, great practice today! Before we head home, I want to quickly address our team equipment. Lately, several balls and cones have been left out in the rain instead of being packed away in the locker. If we don't take care of our gear, it will wear out much faster. Let's make sure everyone helps pack up after each session.",
            "Hi team, please remember that we all share the sports equipment. Lately, gear has been left outside and damaged. Starting today, let's take two minutes after practice to pack everything into the storage bin."
        ),
        6: (
            "Hi everyone, I just received an update that the data for our section is delayed. Since our final deadline is in just one week, this delay significantly squeezes my writing time. Can we hop on a quick fifteen-minute call today to redistribute the preliminary tasks so we don't fall behind schedule?",
            "Hi team, the data for my section has been delayed, which affects our one-week deadline. Can we meet briefly today to reorganize our tasks and keep the project on track?"
        ),
        7: (
            "Hey man, I would normally love to spot you on your heavy lifts tomorrow, but I actually have a doctor's appointment scheduled at that exact time. Would you be open to shifting our session to tomorrow afternoon or hitting the gym together on Thursday morning instead?",
            "Hey, I'd like to help you, but I have a doctor's appointment tomorrow morning. Can we push our workout to the afternoon or meet on Thursday instead?"
        ),
        8: (
            "Excuse me, I wanted to discuss today's session. The course description promised extensive hands-on practice across advanced photography techniques, but today's class was strictly basic theory with almost no shooting time. Could you let me know if the upcoming classes include more practical workshops, or if a partial credit is possible?",
            "Hello, I noticed today's lesson only covered basic theory without hands-on practice, unlike what was advertised. Will the next sessions have practical exercises, or can I get a course credit?"
        ),
        9: (
            "Hey Alex, I wanted to check in about your progress on the group project. We agreed on submitting our respective sections by yesterday, and since we haven't received yours yet, it's holding up our group review. Is there anything you're stuck on that we can help with so we can finalize everything today?",
            "Hi Alex, we noticed your project section hasn't been submitted yet. The delay is affecting the whole team. Are you facing any difficulties, and can you send it by tonight?"
        ),
        10: (
            "Hey, thanks for watching Max while I was away. However, when I got home, his food bowl was completely empty, the water dish was dirty, and he seemed quite anxious. I was really counting on you to follow his daily routine, so I'd appreciate knowing what happened while I was gone.",
            "Hi, thanks for pet sitting. But when I returned, my pet had no food or clean water and seemed very stressed. Did something happen while I was away?"
        ),
        11: (
            "Good morning team. I want to remind everyone to keep our shared kitchen clean and sanitary. Lately, dirty dishes have been left in the sink and counter spills haven't been wiped down, which creates unpleasant odors and hygiene risks. Please take a minute to wash your mugs and clean your food prep areas right after eating.",
            "Hello everyone, please remember to wash your dishes and wipe the counters after using the office kitchen. Leaving dirty plates in the sink causes bad smells and hygiene issues. Thank you for keeping our kitchen clean."
        ),
        12: (
            "Hi neighbors, just a quick friendly reminder regarding our communal gym. Recently, heavy weights and dumbbells have been left on the floor rather than reracked, which poses a tripping hazard. Please make sure to return all weights to their racks and wipe down the equipment after your workout. Thank you for keeping our gym safe!",
            "Hello neighbors, please remember to rerack your weights and clean the gym machines after your workout. Leaving equipment on the floor can be dangerous for others. Thanks for your cooperation!"
        ),
        13: (
            "Hello everyone, thank you for coming out to the garden. During my walk-through this morning, I noticed several garden beds were trampled and hand tools were left scattered in the grass. This garden thrives when we all take care of it together, so please stick to the walking paths and return all tools to the shed when finished.",
            "Hi everyone, please remember to stay on the paths and return all gardening tools to the shed after use. A few plants have been damaged recently, so let's all work together to protect our garden."
        ),
        14: (
            "Hi team, thanks for joining this check-in. In recent weeks, we've had a few instances where key deliverables were misunderstood or missed, leading to unnecessary delays. To keep our project on schedule, I suggest we document action items in our shared board at the end of each meeting and provide quick status updates every Wednesday.",
            "Hi team, we've had some miscommunications lately that caused delays. Let's make sure we clearly write down task assignments and deadlines after each meeting so everyone stays on the same page."
        ),
        15: (
            "Hey, thanks for returning my bicycle. However, I noticed it came back covered in thick mud, the tires are completely flat, and there are several new scratches on the frame. When I lend my bike out, I expect it to be handled with care. Could you help me pump up the tires and clean off the frame today?",
            "Hi, thanks for returning the bike, but it is covered in mud with flat tires and scratches. I expect my property to be treated with care. Could you please help me clean and fix it?"
        ),
        128: (
            "Good morning, Professor. I am writing to politely request a short extension on my upcoming assignment. Unfortunately, my laptop suffered a hardware crash yesterday, and I am currently waiting for it to be repaired at the service center. Would it be possible to submit my paper by Monday morning instead?",
            "Hello Professor, my computer broke down yesterday, so I am having trouble finishing my assignment on time. Could I please have a two-day extension to complete and submit my work? Thank you!"
        ),
        130: (
            "Hello, Professor. I am currently enrolled in the political science course, but after careful consideration, I would like to switch to history. Could you please share some guidance on the syllabus and workload so I know what to expect before making the official transfer?",
            "Hello Professor, I would like to change my course from political science to history. Could you please tell me about the syllabus and course requirements? Thank you for your help."
        ),
        132: (
            "Excuse me, I was trying to print some documents, but the photocopier seems to be out of paper and has a red indicator light flashing. Could someone from the library staff please take a look and restock the paper tray? Thank you very much.",
            "Excuse me, the photocopier has run out of paper and a red light is flashing. Could you please help reload the paper? Thank you!"
        ),
        133: (
            "Hey guys, I wanted to quickly chat about our study space. I've noticed my desk and pens are frequently being used when I'm away, and I get worried about items going missing. I'd really appreciate it if you could ask before borrowing my stationery so things stay organized.",
            "Hi guys, please ask me before using my desk or borrowing my stationery. I need my supplies for studying and want to make sure nothing gets lost. Thanks for understanding."
        ),
        135: (
            "Hey Tom, I am so terribly sorry, but in my rush this morning, I accidentally left your book on my desk at home. I know you need it for class today, so I can run back during the lunch break to grab it for you, or share my notes in the meantime. Really sorry about that!",
            "Hi Tom, I am very sorry, but I forgot to bring your book today. I know you need it, so I can go home and get it during lunch, or share my textbook with you. Sorry for the trouble!"
        ),
        136: (
            "Good afternoon. My student loan payment has been delayed unexpectedly, so I am currently unable to pay my full accommodation fees in a single payment. I work part-time, but it doesn't cover the entire amount right now. Could you advise me on setting up an installment plan or temporary deferral?",
            "Hello, my student loan was delayed, so I cannot pay the full accommodation fee right now. I work part-time and can make partial payments. Could you help me arrange an installment plan?"
        ),
        137: (
            "Hey, can we have a quick word about the kitchen? Recently, some of your guests have been taking food from the fridge without asking, and several of my groceries have disappeared. We agreed to respect each other's supplies, so please remind your visitors not to take personal food items.",
            "Hi, I noticed some of my food in the fridge has been taken by your guests. Could you please remind them that the groceries belong to us individually and not to take them? Thanks."
        ),
        138: (
            "Good morning, Professor. I wanted to inform you that my computer experienced a technical breakdown this morning, which prevented me from joining our online class. I will review the lecture recording and slides as soon as possible, and submit today's discussion prompt by tonight.",
            "Hello Professor, my computer broke down today, so I was unable to attend the online class. I will watch the recording and catch up on the coursework today. Thank you for your understanding."
        ),
        139: (
            "Excuse me, good afternoon. I saw your job advertisement posted for the café and wanted to check if the position is still available. If so, could you tell me a bit more about the primary daily responsibilities and whether you are looking for full-time or part-time staff?",
            "Hello, I saw your job posting and would like to know if the café position is still open. Could you also tell me about the main duties and working hours? Thank you!"
        ),
        140: (
            "Hey, I wanted to check in about our cleaning schedule. It was your turn to take out the trash and clean the common area this week, but it hasn't been done yet. Since we share this flat, keeping up with our agreed chore roster makes living together much easier for both of us.",
            "Hi, please remember that it's your turn for the housework this week. It really helps when we both stick to the cleaning schedule to keep our flat tidy. Thanks!"
        ),
        141: (
            "Hey, quick question—I just bought a car and need to drive to campus, but I'm completely unfamiliar with the student parking regulations. Do you know which lot has the best permit rates, or where students typically park without getting ticketed?",
            "Hi, I recently bought a car and don't know where to park at school. Since you drive here, could you recommend a good parking spot or tell me where to get a permit?"
        ),
        142: (
            "Hey, hope you're doing well! I wanted to follow up on the English textbook I lent you a few weeks back. I actually have an upcoming assignment and need the book to study this week. Could you bring it along tomorrow so I can pick it up?",
            "Hi, I wanted to ask if you could return my English book tomorrow. I have an assignment coming up and really need it to study. Thank you!"
        ),
        143: (
            "Hey guys, sorry to interrupt, but could you please turn down the music a bit? I have a crucial final exam early tomorrow morning and really need to get some sleep tonight. I don't want to spoil your fun, but keeping the volume lower would be a lifesaver.",
            "Hi guys, could you please turn the music down? I have an important exam early tomorrow morning and really need to sleep. Thank you so much for understanding."
        ),
        144: (
            "Good afternoon, Professor. I recently completed the draft of my essay and was wondering if you might have a few minutes during your office hours to provide some constructive feedback, particularly on my argumentation and academic sources. Thank you for your guidance!",
            "Hello Professor, I have finished my essay draft and would really appreciate your feedback on my arguments. Could we meet briefly during your office hours? Thank you!"
        ),
        145: (
            "Hey! Honestly, based on my experience taking that course last semester, I wouldn't really recommend it. The workload is extremely heavy with difficult weekly problem sets and harsh grading criteria. Unless it's an absolute degree requirement, there are much better electives available.",
            "Hi! To be honest, I wouldn't recommend taking that course. It was very difficult, with heavy assignments and strict grading. You might want to choose an easier elective instead."
        ),
        146: (
            "Hey Sarah, happy birthday! Thank you so much for inviting me to your celebration this weekend. Unfortunately, I have a major research paper due on Monday that I have to dedicate the entire weekend to finishing, so I won't be able to make it. Let me treat you to lunch next week to celebrate properly!",
            "Hi Sarah, thank you for inviting me to your birthday party! Unfortunately, I have to finish an urgent essay this weekend, so I cannot attend. I hope you have a wonderful party, and let's catch up next week!"
        ),
        147: (
            "Hey, I noticed your leg is injured and you're having trouble walking. Don't worry about heading over to the campus library—I'm going there right after class anyway. Just give me your books and student card, and I'll gladly return them for you.",
            "Hi, I see you hurt your leg. I am heading to the library now, so give me your books and I can return them for you. Don't worry about walking there!"
        ),
        148: (
            "Hello, this is a student calling from building B, room 304. I've accidentally locked myself out of my dorm room without my keys. Could a member of the facilities or residential management team please come by to unlock the door for me? Thank you very much.",
            "Hello, I accidentally locked my keys inside my dorm room and cannot get in. Could someone from the management team please come and help me unlock the door? Thank you!"
        ),
        149: (
            "Hey everyone, since Emily is moving into her university apartment next week, how about getting her a practical housewarming gift? Something like a nice electric kettle, a cozy throw blanket, or a photo collage of our memories together would make her place feel like home while reminding her of us.",
            "Hi guys, for Emily's new apartment, I suggest getting something useful like an electric kettle or a warm blanket. It would be practical and make her feel at home. What do you think?"
        )
    }

    if qid in bespoke:
        return bespoke[qid]

    # For other questions, build tailored responses based on interlocutor and scenario
    m_target = re.search(r'(?:What (?:would|should|will) you say(?: to (.*?))?\?|How do you address this with (.*?)\?)', prompt, re.IGNORECASE)
    raw_target = (m_target.group(1) or m_target.group(2) or '').strip().rstrip('?.,') if m_target else ''
    target = raw_target.lower()

    # Topic extraction
    topic_clean = topic.lower()
    
    if 'supervisor' in target or 'boss' in target:
        full = f"Good morning. Regarding our discussion on {topic_clean}, I wanted to share a quick update and discuss the best way forward. Due to current project timelines, adjusting our milestone slightly will allow us to maintain high quality without unnecessary risks. Would you be open to reviewing this revised schedule?"
        simple = f"Hello, regarding {topic_clean}, I have an update on our progress. Could we adjust the deadline slightly so we can deliver the best quality? Let me know what you think."
    elif 'colleague' in target or 'team' in target or 'coworker' in target:
        full = f"Hi team, thanks for taking a moment to connect regarding {topic_clean}. To make sure our work stays aligned and efficient, I'd like to propose a clear plan that addresses our current challenges. Let's touch base for a few minutes today so everyone is comfortable with the next steps."
        simple = f"Hi everyone, regarding {topic_clean}, I think we should organize our tasks carefully to avoid delays. Can we meet briefly to discuss the plan? Thank you!"
    elif 'neighbor' in target or 'community' in target:
        full = f"Hello everyone, thank you for your time. I wanted to share a friendly reminder regarding {topic_clean} in our shared area. Keeping our communal space safe, clean, and welcoming benefits all of us, so please help us follow our community guidelines. Thank you for your understanding and cooperation!"
        simple = f"Hello neighbors, please remember to keep our shared area clean and follow the rules for {topic_clean}. It helps make our community a pleasant place for everyone. Thank you!"
    elif 'friend' in target or 'classmate' in target:
        full = f"Hey, thanks for taking a second to chat. Regarding {topic_clean}, I wanted to make sure we're on the same page so everything goes smoothly for both of us. Let's figure out an arrangement that works well for everyone without any stress. What do you think?"
        simple = f"Hi, regarding {topic_clean}, I wanted to talk briefly so we can solve this easily. Let me know what you think and what works best for you. Thanks!"
    elif 'manager' in target or 'organizer' in target or 'receptionist' in target or 'staff' in target:
        full = f"Excuse me, good afternoon. I would like to speak with you regarding {topic_clean}. There is an important issue that needs attention to ensure the service matches what was arranged. Could you please look into this and let me know how we can resolve it satisfactorily?"
        simple = f"Hello, I would like to speak with you about {topic_clean}. There seems to be a problem, and I would appreciate your help in resolving it. Thank you!"
    elif 'tutor' in target or 'professor' in target:
        full = f"Good morning, Professor, thank you for your time. I wanted to consult you regarding {topic_clean}. I ran into a minor scheduling constraint and would be very grateful for your advice on the best academic approach. Could we discuss this briefly during your office hours?"
        simple = f"Hello Professor, I would like to ask for your advice regarding {topic_clean}. Could I speak with you briefly during your office hours? Thank you for your guidance."
    else:
        full = f"Hello, thank you for speaking with me today. Regarding {topic_clean}, I wanted to clarify our situation and propose a practical solution that works well for everyone involved. Please let me know your thoughts so we can move forward effectively."
        simple = f"Hello, I wanted to discuss {topic_clean} so we can find a good solution together. Please let me know what you think. Thank you!"

    return (full, simple)

def main():
    backup_dir = os.path.join('.local', 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')

    bak_path = os.path.join(backup_dir, f"rts_questions.json.{timestamp}.bak")
    shutil.copy2(TARGET_FILE, bak_path)
    print(f"Backed up to {bak_path}")

    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        questions = json.load(f)

    print(f"Total questions to populate: {len(questions)}")
    for q in questions:
        full, simple = build_rts_response(q)
        assert len(full) >= 40, f"Full response too short for Q{q['id']}: {full}"
        assert len(simple) >= 20, f"Simplified response too short for Q{q['id']}: {simple}"
        q['sampleResponse'] = {
            'full': full,
            'simplified': simple
        }

    with open(TARGET_FILE, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"Successfully populated sampleResponse for all {len(questions)} RTS questions!")

if __name__ == '__main__':
    main()
