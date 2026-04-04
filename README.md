# Personal Secretary

First idea of this project:

I want something that helps me figure out what I should do **before starting any plan**.

For example, in my calendar I might have an event like:

```text
Planning sprint for feature ___
```

Normally, that’s just a title. It doesn’t really tell me what I should do.

So the system will:

- categorize it (like → `MEETING`)
- then generate what I should prepare

Something like:

- Review features
- Recheck current implementation
- Recheck any info or resources needed

So it’s more like generating **preparation tasks** for the main task.

That’s why I named it **“Personal Secretary”**.

## But now…

At this phase, the idea changed a bit.

Now I’m focusing more on:

- Feed a goal → let LLM generate tasks to reach that goal
- Generate a schedule that leads to the goal in an efficient way
- Use existing calendar apps (they already handle reminders well)

So instead of replacing calendar apps, I just build on top of them.

## Flow I’m thinking about

1. Input a goal
2. Generate tasks
3. Generate schedule
4. Do the tasks
5. End of the day → update status (like a daily report)
6. System adjusts everything

## Important part

After feedback:

- system knows what is done / not done
- unfinished tasks will be rescheduled
- event time will be extended if needed
- other events will be shifted
- then generate a new schedule again

## How I see it now

For now, It’s not like a “personal secretary” anymore.

It’s more like a:

```text
Personal Product Owner
```

That will:

- plan your sprint
- track your tasks
- update things when reality doesn’t match the plan

## Why I’m building this

Main reason:

> boost my own productivity

Also:

- I don’t want to think too much about planning every time
- Just analyze requirement and generate task for the first time
- I just want a system that tells me what to do next

## Plan

Build this for myself first.

If it works well, I can do another project more efficiently.

That’s it 👍
