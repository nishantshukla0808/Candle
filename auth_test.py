#!/usr/bin/env python3
"""
Extended Authentication Testing for Candle App
Tests actual NextAuth credential login flow
"""

import requests
import re

BASE_URL = "https://trader-hub-82.preview.emergentagent.com"

def test_credentials_auth():
    """Test NextAuth credentials authentication flow"""
    print("=== Testing NextAuth Credentials Authentication ===")
    
    session = requests.Session()
    
    # Step 1: Get CSRF token
    csrf_response = session.get(f"{BASE_URL}/api/auth/csrf")
    if csrf_response.status_code == 200:
        csrf_token = csrf_response.json().get('csrfToken')
        print(f"✅ Got CSRF token: {csrf_token[:10]}...")
    else:
        print("❌ Failed to get CSRF token")
        return False
    
    # Step 2: Test credentials login
    login_data = {
        'email': 'test.trader@candle.com',
        'password': 'candle123',
        'csrfToken': csrf_token,
        'callbackUrl': BASE_URL,
        'json': 'true'
    }
    
    # Post to credentials provider
    auth_response = session.post(
        f"{BASE_URL}/api/auth/callback/credentials",
        data=login_data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        }
    )
    
    print(f"Auth response status: {auth_response.status_code}")
    
    if auth_response.status_code == 200:
        auth_data = auth_response.json()
        if auth_data.get('url'):
            print("✅ NextAuth credentials login successful")
            
            # Step 3: Test authenticated endpoint
            profile_response = session.get(f"{BASE_URL}/api/user/profile")
            if profile_response.status_code == 200:
                profile_data = profile_response.json()
                if 'user' in profile_data:
                    user = profile_data['user']
                    print(f"✅ Authenticated user profile: {user.get('name')} ({user.get('email')})")
                    print(f"   XP: {user.get('xp')}, Level: {user.get('level')}")
                    return True
                else:
                    print("❌ Profile response missing user data")
                    return False
            else:
                print(f"❌ Profile endpoint failed: {profile_response.status_code}")
                return False
        else:
            print(f"❌ Auth response missing URL: {auth_data}")
            return False
    else:
        print(f"❌ Authentication failed: {auth_response.status_code}")
        try:
            print(f"Response: {auth_response.json()}")
        except:
            print(f"Response text: {auth_response.text[:200]}...")
        return False

def test_authenticated_apis():
    """Test authenticated APIs with session"""
    print("\n=== Testing Authenticated APIs with Session ===")
    
    session = requests.Session()
    
    # Login first
    csrf_response = session.get(f"{BASE_URL}/api/auth/csrf")
    csrf_token = csrf_response.json().get('csrfToken')
    
    login_data = {
        'email': 'test.trader@candle.com',
        'password': 'candle123',
        'csrfToken': csrf_token,
        'callbackUrl': BASE_URL,
        'json': 'true'
    }
    
    auth_response = session.post(
        f"{BASE_URL}/api/auth/callback/credentials",
        data=login_data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    
    if auth_response.status_code != 200:
        print("❌ Failed to authenticate for API testing")
        return False
    
    # Test authenticated endpoints
    test_results = {}
    
    # Test lesson completion
    print("Testing lesson completion...")
    complete_response = session.post(f"{BASE_URL}/api/lessons/lesson-1/complete")
    test_results['lesson_complete'] = complete_response.status_code == 200
    if complete_response.status_code == 200:
        data = complete_response.json()
        print(f"✅ Lesson completion: {data.get('message')}, XP: {data.get('xpAwarded')}")
    else:
        print(f"❌ Lesson completion failed: {complete_response.status_code}")
    
    # Test quiz submission
    print("Testing quiz submission...")
    quiz_data = {"answers": [1, 1, 2, 1, 1]}
    quiz_response = session.post(f"{BASE_URL}/api/quiz/lesson-1/submit", json=quiz_data)
    test_results['quiz_submit'] = quiz_response.status_code == 200
    if quiz_response.status_code == 200:
        data = quiz_response.json()
        print(f"✅ Quiz submission: Score {data.get('score')}/{data.get('totalQuestions')}, Bonus XP: {data.get('bonusXP')}")
    else:
        print(f"❌ Quiz submission failed: {quiz_response.status_code}")
    
    # Test daily challenge completion
    print("Testing daily challenge completion...")
    challenge_response = session.post(f"{BASE_URL}/api/daily-challenge/complete")
    test_results['daily_challenge'] = challenge_response.status_code == 200
    if challenge_response.status_code == 200:
        data = challenge_response.json()
        print(f"✅ Daily challenge: {data.get('message')}")
    else:
        print(f"❌ Daily challenge failed: {challenge_response.status_code}")
    
    # Test AI suggestion
    print("Testing AI suggestions...")
    ai_response = session.post(f"{BASE_URL}/api/ai/suggest", json={})
    test_results['ai_suggest'] = ai_response.status_code == 200
    if ai_response.status_code == 200:
        data = ai_response.json()
        suggestion = data.get('suggestion', '')
        print(f"✅ AI suggestion received: {suggestion[:100]}...")
    else:
        print(f"❌ AI suggestion failed: {ai_response.status_code}")
        try:
            print(f"Error: {ai_response.json()}")
        except:
            print(f"Response: {ai_response.text[:200]}...")
    
    # Summary
    passed = sum(test_results.values())
    total = len(test_results)
    print(f"\nAuthenticated API Tests: {passed}/{total} passed")
    
    return passed == total

if __name__ == "__main__":
    try:
        # Test authentication
        auth_success = test_credentials_auth()
        
        if auth_success:
            # Test authenticated APIs
            api_success = test_authenticated_apis()
            
            if api_success:
                print("\n🎉 All authentication and API tests passed!")
                exit(0)
            else:
                print("\n⚠️ Some authenticated API tests failed")
                exit(1)
        else:
            print("\n❌ Authentication test failed")
            exit(1)
            
    except Exception as e:
        print(f"\n❌ Test execution failed: {str(e)}")
        exit(1)