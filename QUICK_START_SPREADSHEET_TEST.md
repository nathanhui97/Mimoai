# 🚀 Quick Start - Spreadsheet Engine Test (5 Minutes)

## Step 1: Build & Reload (1 minute)

```bash
cd "/Users/nathhui/Documents/mimoai"
npm run build
```

Then:
1. Go to `chrome://extensions`
2. Find "mimoai"
3. Click the **Reload** button 🔄

---

## Step 2: Open Google Sheets (30 seconds)

1. Open: https://sheets.google.com
2. Click **"Blank"** to create new spreadsheet
3. Press **F12** to open Developer Console

---

## Step 3: Set Up Test Data (1 minute)

Type these headers in row 1:
- **A1**: Name
- **B1**: Email  
- **C1**: Phone

---

## Step 4: Run Tests (3 minutes)

Open mimoai side panel and try these commands:

### Test 1: Direct Cell Input ⚡
```
Type "Hello World" in cell A2
```

**Expected**: 
- Cell A2 contains "Hello World"
- Console shows: `✅ Successfully typed "Hello World" in cell A2`

---

### Test 2: Header-Based Input 🎯
```
In the Email column, row 2, type "test@example.com"
```

**Expected**:
- Cell B2 contains "test@example.com"
- Console shows header matching logs

---

### Test 3: Build a List 📝
```
Create a contact list with these 3 people:
- John Doe, john@test.com, 555-1111
- Jane Smith, jane@test.com, 555-2222
- Bob Wilson, bob@test.com, 555-3333
```

**Expected**:
- Rows 2-4 filled with all contact data
- All cells aligned properly in columns
- Console shows multiple successful operations

---

### Test 4: Next Empty Row ➕
```
Add "Sarah Parker" to the next empty row in the Name column
```

**Expected**:
- Cell A5 contains "Sarah Parker"
- Agent correctly identified row 5 as next empty

---

### Test 5: Batch Input 🔥
```
Fill row 6 with: Name="Mike Chen", Email="mike@test.com", Phone="555-5555"
```

**Expected**:
- All three cells filled in one operation
- Faster than individual operations

---

## ✅ Success Indicators

### In the Console (F12):
```
📊 SpreadsheetExecutor: Executing action: type_in_cell
📊 Attempt 1/3
📊 Successfully navigated to B5 via Name Box
📊 Typed "Hello World" via formula bar
✅ Successfully typed "Hello World" in cell B5
```

### In the Spreadsheet:
- All cells contain correct values
- No random empty cells
- Data aligned in proper columns
- Operations complete in < 2 seconds each

---

## 🚨 Troubleshooting

### "Navigation failed"
- **Fix**: Refresh the spreadsheet page
- **Fix**: Ensure Name Box is visible (top-left of sheet)

### "Typing failed"  
- **Fix**: Click on a cell manually first
- **Fix**: Make sure sheet is in edit mode (not viewing)

### "Verification mismatch"
- **Fix**: Check if Google Sheets auto-formatted your value
- **Fix**: Try with simple text (no numbers/dates)

### No console logs
- **Fix**: Make sure you rebuilt the extension
- **Fix**: Reload extension in `chrome://extensions`
- **Fix**: Refresh the spreadsheet page

---

## 🎯 What to Look For

### Good Signs ✅:
- Console shows `✅ Successfully typed...`
- Operations complete in < 1 second
- Name Box strategy used (most reliable)
- Verification passes on first attempt

### Warning Signs ⚠️:
- Multiple retry attempts
- "Verification failed" messages
- Operations taking > 3 seconds
- Errors in console

### Critical Issues 🔴:
- "All strategies failed"
- "Not on spreadsheet domain"
- Repeated failures after retries
- Extension crash

---

## 📊 Quick Performance Check

Time these operations:

| Test | Expected Time | Your Time |
|------|---------------|-----------|
| Single cell input | < 1 sec | ____ sec |
| Header-based input | < 2 sec | ____ sec |
| 3-person list | < 5 sec | ____ sec |
| Batch (3 cells) | < 3 sec | ____ sec |

If any operation takes > 2x expected time, check console for issues.

---

## 🎉 Next Steps

### If All Tests Pass:
1. ✅ Mark as tested in your records
2. Try more complex scenarios (see `SPREADSHEET_INPUT_ENGINE_TESTING.md`)
3. Test on Excel Online
4. Test with different spreadsheet structures

### If Tests Fail:
1. Note which test failed
2. Copy console error messages
3. Check troubleshooting section
4. Review `SPREADSHEET_INPUT_ENGINE_TESTING.md` for detailed debugging

---

## 📞 Quick Support

**Console shows errors?**
→ Read the error message carefully, it usually tells you what's wrong

**Cell values wrong?**
→ Check for auto-formatting (Google Sheets converts "555-1111" to date format sometimes)

**Nothing happens?**
→ Ensure you're on Google Sheets or Excel Online (not other sites)

**Still stuck?**
→ Check the comprehensive testing guide: `SPREADSHEET_INPUT_ENGINE_TESTING.md`

---

**Estimated Time**: 5 minutes  
**Difficulty**: Easy  
**Prerequisites**: Extension installed, Google account

Good luck! 🍀

