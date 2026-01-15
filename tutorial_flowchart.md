# Tutorial System Flowchart

This flowchart visualizes the logic for every tutorial currently implemented in the application, including triggers, decision logic, and completion states.

```mermaid
graph TD
    %% Global Trigger Logic
    User[User Interaction / Unlock Event] --> Dispatcher{Select Tutorial}

    %% Length Filter Tutorials (tutorial.js) which was Refactored
    subgraph Length_Filter_System [Length Filter Tutorials]
        Dispatcher -- "Unlock Type Filter" --> TypeTut[Type Mode Tutorial]
        Dispatcher -- "Unlock Speak Filter" --> SpeakTut[Speak Mode Tutorial]
        
        TypeTut --> CheckType{Show?}
        SpeakTut --> CheckSpeak{Show?}
        
        CheckType -- Replay=True OR !Completed --> RunType[<b>Run Type Tutorial</b>]
        CheckType -- Completed & Replay=False --> SkipType([Skip])
        
        CheckSpeak -- Replay=True OR !Completed --> RunSpeak[<b>Run Speak Tutorial</b>]
        CheckSpeak -- Completed & Replay=False --> SkipSpeak([Skip])
        
        RunType --> EndType[Mark Completed] --> ResetTypeReplay[Set Replay=False]
        RunSpeak --> EndSpeak[Mark Completed] --> ResetSpeakReplay[Set Replay=False]
    end

    %% Vocab Book Tutorials (vocab-tutorial.js)
    subgraph Vocab_System [Vocabulary Book Tutorials]
        Dispatcher -- "First Open Vocab Book" --> IntroTut[Vocab Book Intro]
        Dispatcher -- "SRS: Listen & Type" --> TypMode[Listen & Type Tutorial]
        Dispatcher -- "SRS: Listen & Repeat" --> RepMode[Listen & Repeat Tutorial]
        Dispatcher -- "SRS: Cloze" --> ClozeMode[Cloze / Fill Tutorial]
        Dispatcher -- "Writing Challenge" --> WriteTut[Writing Challenge Tutorial]

        %% Logic for Vocab Tutorials
        IntroTut --> VCheck{Show?}
        TypMode --> TCheck{Show?}
        RepMode --> RCheck{Show?}
        ClozeMode --> CCheck{Show?}
        WriteTut --> WCheck{Show?}
        
        VCheck -- Replay=True OR !Completed --> RunIntro[<b>Run Intro</b>]
        VCheck -- Else --> SkipIntro([Skip])

        TCheck -- Replay=True OR !Completed --> RunTyp[<b>Run Listen/Type</b>]
        TCheck -- Else --> SkipTyp([Skip])

        RCheck -- Replay=True OR !Completed --> RunRep[<b>Run Listen/Repeat</b>]
        RCheck -- Else --> SkipRep([Skip])

        CCheck -- Replay=True OR !Completed --> RunCloze[<b>Run Cloze</b>]
        CCheck -- Else --> SkipCloze([Skip])

        WCheck -- Replay=True OR !Completed --> RunWrite[<b>Run Writing</b>]
        WCheck -- Else --> SkipWrite([Skip])

        %% Completion Logic
        RunIntro --> FinishVocab[Mark Completed & Disable Replay]
        RunTyp --> FinishVocab
        RunRep --> FinishVocab
        RunCloze --> FinishVocab
        RunWrite --> FinishVocab
    end

    %% Settings Interaction
    subgraph Settings_UI [Settings & Preferences]
        UserSetting[User Toggles Replay Checkbox] --> ToggleAction{Check/Uncheck}
        
        ToggleAction -- "Check (Enable)" --> EnableReplay[Set Replay=True]
        ToggleAction -- "Uncheck (Disable)" --> DisableReplay[Set Replay=False]
        
        EnableReplay --> Note1[Does NOT Affect Completion Status]
        DisableReplay --> Note1
    end
```

## Tutorial List & Triggers

| Tutorial Name | Trigger | File |
| :--- | :--- | :--- |
| **Length Filter (Type)** | Unlocking the length filter in Type Mode | `tutorial.js` |
| **Length Filter (Speak)** | Unlocking the length filter in Speak Mode | `tutorial.js` |
| **Vocab Book Intro** | Unlocking/Opening the Vocab Book for the first time | `vocab-tutorial.js` |
| **Listen & Type** | Starting a "Listen & Type" SRS session | `vocab-tutorial.js` |
| **Listen & Repeat** | Starting a "Listen & Repeat" SRS session | `vocab-tutorial.js` |
| **Cloze (Fill)** | Starting a "Fill in the Blank" SRS session | `vocab-tutorial.js` |
| **Writing Challenge** | Triggering the Writing Challenge event in SRS | `vocab-tutorial.js` |

## Recent Fixes

- **Replay Logic**: Fixed a critical flaw in `tutorial.js` where disabling replay would incorrectly mark a tutorial as "completed" for new users.
- **State Safety**: Enabling replay no longer deletes the "Completed" history.
- **Conflict Resolution**: `tutorial.js` no longer attempts to handle 'Writing' or 'Cloze' settings, ceding control to the specialized `vocab-tutorial.js`.
